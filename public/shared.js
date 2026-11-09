/**
 * 共通ユーティリティ
 * 複数ページで使う関数をここに集約する
 */

/**
 * DD値を小数第1位に丸める。
 *
 * 難度上限（perSkillDDCap/routineDDCap）との比較は、表示精度（toFixed(1)）と
 * 揃えるためにこれを通してから行うこと。素の値のまま比較すると、複数の技のDDを
 * 順に加算していく過程で浮動小数点の丸め誤差が乗り（例: 0.6+0.1+1.5+...+0.3 の
 * 合計が数学的には7.9でも実際は7.900000000000001になる）、表示上は上限とちょうど
 * 同じ値なのに「上限超え」の色が付いてしまうことがある。
 */
export function round1(v) {
    return Math.round(v * 10) / 10;
}

/**
 * 「値が前回と実質的に変わっていなければ何もしない」ガード。
 *
 * tournaments/{id} のような、無関係な用途のフィールドが多数同居する巨大ドキュメントを
 * 丸ごと onSnapshot している画面（会場ディスプレイ・大会画面コントロール等）は、
 * 自分に無関係なフィールドの書き込みでもハンドラが毎回発火してしまう。
 * その中で「このサブフィールドは今回のスナップショットで本当に変わったか」を判定し、
 * 変わった時だけ apply を呼ぶことで、無関係な発火のたびに入力中のフォームを
 * 保存済みの値で上書きしたり、無駄な再描画をしたりするのを防ぐ。
 *
 * @param {object} cache  シグネチャを保持する入れ物（呼び出し側がモジュールスコープ等で用意する、
 *                        key ごとに複数の値を管理できる単なるオブジェクト）
 * @param {string} key    cache 内でこの値を識別するキー
 * @param {*} value       今回のスナップショットで得た値（比較対象。JSON化できる範囲のみ）
 * @param {(value:*) => void} apply  値が変化した時だけ呼ばれる反映関数
 */
export function applyIfChanged(cache, key, value, apply) {
  const sig = JSON.stringify(value ?? null);
  if (cache[key] === sig) return;
  cache[key] = sig;
  apply(value);
}

/**
 * classRules を新旧フォーマットに統一して返す
 *   旧形式: { クラス名: { ... } }
 *   新形式: { individual: { クラス名: {...} }, synchro: { クラス名: {...} } }
 */
export function normalizeClassRules(raw) {
  if (!raw) return { individual: {}, synchro: {} };
  if ('individual' in raw || 'synchro' in raw) return raw;
  if (Object.keys(raw).length > 0) return { individual: raw, synchro: {} };
  return { individual: {}, synchro: {} };
}

// ============================================================
//  順位計算ユーティリティ（ranking.html / display.html / admin_final_order.html 共用）
// ============================================================

/**
 * 結果オブジェクトからタイブレーク用スコアを抽出
 * @param {object|null} result  Firestore result document data
 * @returns {{ tof: number|null, hd: number|null, diff: number|null }}
 */
export function extractTbScores(result) {
  if (!result) return { tof: null, hd: null, diff: null };
  return {
    tof:  result.tof                    ?? null,
    hd:   result.hd?.total              ?? null,
    diff: result.officialD ?? result.dd ?? null   // dd は旧フィールド名フォールバック
  };
}

/**
 * 予選スコア計算（numPre / scoreMode に応じて）
 * @param {number|null} pre1
 * @param {number|null} pre2
 * @param {number} numPre     予選本数
 * @param {'best'|'total'} scoreMode
 * @returns {number|null}
 */
export function calcQualifyingScore(pre1, pre2, numPre, scoreMode) {
  if (numPre === 1) return pre1 ?? null;
  if (pre1 != null && pre2 != null)
    return scoreMode === 'total' ? pre1 + pre2 : Math.max(pre1, pre2);
  return pre1 ?? pre2 ?? null;
}

/**
 * 予選タイブレーク用データ計算
 *   best採用: tbSum = 2本合計、tb = ベスト演技の T/H/D
 *   total採用: tbSum = null（qualScore が既に合計）、tb = 2本合計の T/H/D
 * @param {number|null} pre1
 * @param {number|null} pre2
 * @param {object|null} pre1r  pre1 の Firestore result document data
 * @param {object|null} pre2r  pre2 の Firestore result document data
 * @param {number} numPre
 * @param {'best'|'total'} scoreMode
 * @returns {{ tbSum: number|null, tb: { tof, hd, diff } }}
 */
export function calcQualifyingTb(pre1, pre2, pre1r, pre2r, numPre, scoreMode) {
  if (numPre < 2 || pre1 == null || pre2 == null) {
    return { tbSum: null, tb: extractTbScores(pre1 != null ? pre1r : pre2r) };
  }
  if (scoreMode === 'best') {
    return {
      tbSum: pre1 + pre2,
      tb:    extractTbScores(pre1 >= pre2 ? pre1r : pre2r)
    };
  } else {
    const s1 = extractTbScores(pre1r), s2 = extractTbScores(pre2r);
    return {
      tbSum: null,
      tb: {
        tof:  (s1.tof  ?? 0) + (s2.tof  ?? 0),
        hd:   (s1.hd   ?? 0) + (s2.hd   ?? 0),
        diff: (s1.diff ?? 0) + (s2.diff ?? 0)
      }
    };
  }
}

/**
 * 決勝スコア計算（finalScoreMode に応じて）
 * @param {number|null} qualPre       予選スコア（combined モード時に使用）
 * @param {number|null} final         決勝スコア
 * @param {'zero'|'combined'} finalScoreMode
 * @returns {number|null}
 */
export function calcFinalScore(qualPre, final, finalScoreMode) {
  if (finalScoreMode === 'combined') {
    if (qualPre != null && final != null) return qualPre + final;
    return final ?? qualPre ?? null;
  }
  // zero: 決勝スコア単体（未確定時は null → 末尾へ）
  return final ?? null;
}

/**
 * ランキング用ソート比較関数（降順、null 末尾）
 * TR2025 §4.4.4: 主スコア → 2本合計（best採用時のみ）→ T → H → D
 *
 * 各エントリは以下を持つこと:
 *   { qualScore: number|null, tbSum: number|null, tb: { tof, hd, diff } }
 *
 * @returns {number}  負 = a が上位
 */
export function compareRankEntries(a, b) {
  if (a.qualScore == null && b.qualScore == null) return 0;
  if (a.qualScore == null) return  1;
  if (b.qualScore == null) return -1;
  // ① 主スコア（小数第 3 位で比較）
  const as2 = Math.round(a.qualScore * 1000) / 1000;
  const bs2 = Math.round(b.qualScore * 1000) / 1000;
  if (bs2 !== as2) return bs2 - as2;
  // ② 2本合計（best採用時のみ; total採用時は tbSum = null なので skip）
  if (a.tbSum != null && b.tbSum != null && Math.abs(b.tbSum - a.tbSum) > 1e-9) return b.tbSum - a.tbSum;
  // ③ T（個人=ToF / シンクロ=Syn）→ H → D
  for (const k of ['tof', 'hd', 'diff']) {
    const va = a.tb?.[k], vb = b.tb?.[k];
    if (va != null && vb != null && Math.abs(vb - va) > 1e-9) return vb - va;
  }
  return 0;
}

/**
 * ランク番号割り当て（同点タイ対応）
 * compareRankEntries でソート済みの配列を受け取り、各エントリに .rank を付与する
 * @param {Array} entries  mutable, ソート済み
 * @returns {Array}  同一参照（チェーン用）
 */
export function assignRanks(entries) {
  entries.forEach((r, idx) => {
    if (idx === 0) { r.rank = 1; return; }
    const prev = entries[idx - 1];
    if (r.qualScore == null || prev.qualScore == null) { r.rank = idx + 1; return; }
    // タイ判定はソート基準 (compareRankEntries) と完全一致させる
    // （独自の === 比較だと浮動小数誤差でソートと食い違い、同着の順位がずれることがある）
    r.rank = compareRankEntries(r, prev) === 0 ? prev.rank : idx + 1;
  });
  return entries;
}

// ============================================================

/**
 * トランポリン競技ボーナス点計算 (FIG規則)
 *   男子: 5本超のトリプル 1本につき +0.3（6本目以降）
 *   女子・混合: 2本超のトリプル 1本につき +0.3（3本目以降）
 */
export function calcBonus(gender, tripleCount) {
  if (gender === '男子' && tripleCount > 5) return (tripleCount - 5) * 0.3;
  if ((gender === '女子' || gender === '混合') && tripleCount >= 3) return (tripleCount - 2) * 0.3;
  return 0;
}

// ============================================================
//  難度（DD）計算（entry / admin_card_check / judge_cjp / judge_panel / display / score_viewer 共用）
//  以前は各ページに同じ計算が別々に書かれていて、ルールの追加（上限の丸め込み/失格など）のたびに
//  全ページの修正が必要だった。クラスルールの読み取りと計算本体はここに集約し、
//  各ページは結果を自分の画面の色・文言に反映するだけにする。
// ============================================================

/**
 * クラスルールから難度に関する設定を読み取る。
 * @param {object} rule   classRules[type][class]（未設定は {}）
 * @param {string} round  'pre1' | 'pre2' | 'final'（指定難度は予選1本目のみ有効なため）
 * @returns {{
 *   perSkillDDCap: number|null,  1技あたり難度上限（設定なし=null。失格モードでも値は入る）
 *   perSkillDQ: boolean,         true=上限超過は丸め込まず失格
 *   routineDDCap: number|null,   構成あたり難度上限
 *   routineDQ: boolean,
 *   minRoutineDD: number|null,   難度下限
 *   designatedDDCount: number    指定難度本数（-1=無効, 0=全DD0, 1以上=N本指定。2本合計・予選1本目のみ有効）
 * }}
 */
export function parseDDRule(rule, round) {
  const r = rule || {};
  const num = v => { const n = parseFloat(v); return (v != null && !isNaN(n)) ? n : null; };
  const rawDesig = (r.designatedDDCount != null && r.designatedDDCount >= 0) ? r.designatedDDCount : -1;
  const desigValid = rawDesig >= 0 && r.qualifyingRoutines === 2 && r.scoreMode === 'total' && round === 'pre1';
  return {
    perSkillDDCap: num(r.perSkillDDCap),
    perSkillDQ:    r.perSkillDDCapMode === 'disqualify',
    routineDDCap:  num(r.routineDDCap),
    routineDQ:     r.routineDDCapMode === 'disqualify',
    minRoutineDD:  num(r.minRoutineDD),
    designatedDDCount: desigValid ? rawDesig : -1,
  };
}

/**
 * 競技カード（最大10技）の難度を計算する。
 *  - 同じ技（key が同じ）は2回目以降 0.0 点（基礎点・トリプル数に含めない）
 *  - 指定難度: count<0 は全技有効、0 は全技無効、1以上は designatedIndices に含まれる技のみ有効
 *  - 1技あたり上限: 超えた技は上限値で計算（失格モードのクラスは丸め込まず overCap だけ立てる）
 *  - 構成上限: 合計（基礎点＋ボーナス）が超えたら上限で頭打ち（失格モードは丸め込まず routineOverDQ を立てる）
 *  - 上限との比較は小数第1位に丸めてから行う（浮動小数の誤差で「ちょうど上限」が超過扱いにならないように）
 *
 * @param {object} p
 * @param {Array<{key:string, dd:number|null, isTriple?:boolean}|null>} p.skills  技（空欄・未解決は null）。10要素まで
 * @param {string} p.gender             ボーナス計算用（'男子'|'女子'|'混合'）
 * @param {object} p.ddRule             parseDDRule の戻り値
 * @param {number[]|Set<number>} [p.designatedIndices]  指定難度に選んだ技の位置（0始まり）
 * @param {number} [p.validLimit=10]    有効本数（これ以降の技は計算・重複判定の対象外。中断時など）
 * @returns {{ rows:Array, baseDD:number, tripleCount:number, bonus:number, rawTotal:number, total:number,
 *             routineOverCap:boolean, routineCapped:boolean, routineOverDQ:boolean, skillOverCapDQ:boolean }}
 *   rows[i]: { index, blank, beyondLimit, skill, isDesignated, isDupRow, isDupZero, overCap, isCapped, counted, usedDD }
 */
export function calcCardDD({ skills, gender, ddRule, designatedIndices = [], validLimit = 10 }) {
  const { perSkillDDCap: pc, perSkillDQ, routineDDCap: rc, routineDQ, designatedDDCount: dc } = ddRule;
  const desigSet = designatedIndices instanceof Set ? designatedIndices : new Set(designatedIndices);

  const keyCounts = {};
  for (let i = 0; i < 10 && i < validLimit; i++) {
    const s = skills[i];
    if (s && s.key) keyCounts[s.key] = (keyCounts[s.key] || 0) + 1;
  }

  const rows = [], seen = new Set();
  let baseDD = 0, tripleCount = 0, skillOverCapDQ = false;
  for (let i = 0; i < 10; i++) {
    const s = skills[i] || null;
    const isDesignated = dc < 0 || (dc > 0 && desigSet.has(i));
    const row = { index: i, blank: !s, beyondLimit: i >= validLimit, skill: s, isDesignated,
                  isDupRow: false, isDupZero: false, overCap: false, isCapped: false, counted: false, usedDD: 0 };
    rows.push(row);
    if (row.beyondLimit || !s) continue;

    row.isDupRow  = !!s.key && keyCounts[s.key] > 1;
    row.isDupZero = !!s.key && seen.has(s.key);
    if (s.key) seen.add(s.key);

    const dd = s.dd;
    row.overCap  = !row.isDupZero && pc != null && dd != null && round1(dd) > pc;
    row.isCapped = row.overCap && !perSkillDQ;
    row.usedDD   = row.isDupZero ? 0 : (row.isCapped ? pc : (dd ?? 0));
    row.counted  = isDesignated && !row.isDupZero;
    if (row.counted) {
      if (dd != null) baseDD += row.usedDD;
      if (s.isTriple) tripleCount++;
      if (row.overCap && perSkillDQ) skillOverCapDQ = true;
    }
  }

  const bonus = calcBonus(gender || '', tripleCount);
  const rawTotal = baseDD + bonus;
  const routineOverCap = rc != null && round1(rawTotal) > rc;
  const routineCapped  = routineOverCap && !routineDQ;
  const routineOverDQ  = routineOverCap && routineDQ;
  return { rows, baseDD, tripleCount, bonus, rawTotal, total: routineCapped ? rc : rawTotal,
           routineOverCap, routineCapped, routineOverDQ, skillOverCapDQ };
}

// ============================================================
//  審判構成ブロック（judge_roster.html / admin_roster_order.html 共用）
// ============================================================

/**
 * eJudgeCount の新旧フォーマットを吸収して、指定ラウンドのE審判人数を返す。
 *   旧形式: 数値そのもの（予選・決勝で共通）
 *   新形式: { pre: 予選の人数, final: 決勝の人数 }（予選・決勝を個別に設定した場合）
 * 該当ラウンドの値が読み取れない場合は null を返す（呼び出し側でデフォルト値にフォールバックすること）。
 * @param {*} raw     rule.eJudgeCount の生値
 * @param {'予選'|'決勝'|'pre1'|'pre2'|'final'} round
 * @returns {number|null}
 */
export function resolveEJudgeCount(raw, round) {
  const bucket = (round === '決勝' || round === 'final') ? 'final' : 'pre';
  const pick = (raw && typeof raw === 'object') ? raw[bucket] : raw;
  const n = parseInt(pick);
  return (!isNaN(n) && n > 0) ? n : null;
}

/**
 * クラス別のロール配列を返す（E審判人数・H5H6の有無を反映）。
 * round を渡すと、予選・決勝で個別にE審判人数を設定している場合にそのラウンドの人数を使う
 * （省略時・旧形式データは予選・決勝で共通の値として扱う）。
 */
export function getJudgeRoles(name, type, classRules, round) {
  const rule   = classRules[type]?.[name] || {};
  const numE   = resolveEJudgeCount(rule.eJudgeCount, round) || 4;
  const hasH56 = rule.hasH5H6 === true;
  const roles  = [['cjp', 'CJP']];
  for (let i = 1; i <= numE; i++) roles.push([`e${i}`, `E${i}`]);
  if (hasH56) roles.push(['h5', 'H5'], ['h6', 'H6']);
  roles.push(['d7', 'D7'], ['d8', 'D8']);
  return roles;
}

/**
 * 審判構成の「表示順設定」機能で使う、クラス×性別×ラウンド（または旧形式ではクラスのみ）を
 * 一意に識別するキー。judgeConfig.rosterOrder にはこのキーの並び順を保存する。
 */
export function judgeRosterLeafKey(className, gender, round) {
  return gender ? `${className}::${gender}::${round}` : className;
}

/**
 * クラス一覧を、同一の審判構成（fingerprint）ごとにまとめてグループ化する。
 * judge_roster.html（表示）と admin_roster_order.html（並び替え設定）の両方で
 * 同じグルーピング結果になるよう、ロジックをここに集約している。
 *
 * @param {Array<{name:string}>} list  対象クラス一覧（選手登録済みのもののみ）
 * @param {'individual'|'synchro'} type
 * @param {object} judgeConfig  d.judgeConfig.classes
 * @param {object} classRules   d.classRules
 * @returns {Array<{sections:Array, data:object, ROLES:Array, leafKeys:string[]}>}  クラス定義順（自然順）
 */
export function buildJudgeRosterGroups(list, type, judgeConfig, classRules) {
  const ROUNDS  = ['予選', '決勝'];
  const groupMap = new Map();

  list.forEach(({ name }) => {
    const classData = judgeConfig[type]?.[name] || judgeConfig[name] || {};
    // 旧形式検出（トップレベルキーに cjp/e1 等が含まれる）。旧形式は予選/決勝の区別が無いデータなので
    // ラウンド不問の1系統として扱い、ROLESもラウンド指定なし（＝予選扱い）で計算する。
    const isOldFormat = Object.keys(classData).some(k => ['cjp', 'e1', 'e2', 'e3', 'e4', 'd7', 'd8'].includes(k));

    if (isOldFormat) {
      const ROLES = getJudgeRoles(name, type, classRules);
      const hasAny = ROLES.some(([k]) => classData[k]);
      if (!hasAny) return;
      const fp = JSON.stringify(ROLES.map(([k]) => [k, classData[k] || '', classData[k + '_kind'] || '']));
      if (!groupMap.has(fp)) groupMap.set(fp, { sections: [], data: classData, ROLES });
      groupMap.get(fp).sections.push({ className: name, gender: '', round: '' });
    } else {
      // 新形式のトップレベルキーは実際に登録されている性別（"男子"/"女子"に限らず
      // "混合"等も含む）。judge_config.htmlのbuildClassCard()も選手データから実際の
      // 性別を集計してカードを作っているため、ここを"男子"/"女子"に決め打ちすると、
      // 混合クラス（シンクロ等）の審判構成データが存在していても一切拾えず、
      // judge_roster.html/admin_roster_order.htmlから丸ごと消えてしまっていた。
      const genders = Object.keys(classData);
      for (const g of genders) {
        for (const r of ROUNDS) {
          const sec = classData[g]?.[r];
          if (!sec) continue;
          // 予選・決勝でE審判人数が異なりうるため、ROLESはラウンドごとに計算する
          // （ここをクラス単位で1回だけ計算すると、予選と決勝で本来別々のはずの
          //   役割数・fingerprintが同じになり、誤って同一ブロックに統合されてしまう）
          const ROLES = getJudgeRoles(name, type, classRules, r);
          const hasAny = ROLES.some(([k]) => sec[k]);
          if (!hasAny) continue;
          const fp = JSON.stringify(ROLES.map(([k]) => [k, sec[k] || '', sec[k + '_kind'] || '']));
          if (!groupMap.has(fp)) groupMap.set(fp, { sections: [], data: sec, ROLES });
          groupMap.get(fp).sections.push({ className: name, gender: g, round: r });
        }
      }
    }
  });

  return [...groupMap.values()].map(g => ({
    ...g,
    leafKeys: g.sections.map(s => judgeRosterLeafKey(s.className, s.gender, s.round))
  }));
}

/**
 * 保存済みの表示順（leafKeyの配列）に従って groups を並べ替える。
 * 該当する保存順が無い（未設定・新しいクラス等）場合は、クラス定義順（自然順）のまま
 * 末尾へ寄せる（Array#sort の安定性により、対象外グループ同士の相対順は維持される）。
 */
export function applyJudgeRosterOrder(groups, savedOrder) {
  if (!savedOrder || !savedOrder.length) return groups;
  const idx = new Map(savedOrder.map((k, i) => [k, i]));
  return groups
    .map((g, i) => ({
      g, i,
      sortKey: Math.min(...g.leafKeys.map(k => idx.has(k) ? idx.get(k) : Infinity))
    }))
    .sort((a, b) => a.sortKey - b.sortKey || a.i - b.i)
    .map(x => x.g);
}

/**
 * 「非表示」に設定されたブロックを除外する（judge_roster.htmlの表示専用。
 * admin_roster_order.htmlの並べ替え画面自体には全ブロックを表示し続けるため、この関数は呼ばない）。
 * 保存はleafKey単位（クラス×性別×ラウンド）で行うため、ブロックを構成する全leafKeyが
 * 非表示指定に含まれている場合のみそのブロックを除外する（一部だけ非表示指定が残っている
 * 場合は、後から審判構成が変わってブロックの組み合わせ自体が変化したケースなどを考慮し、
 * 安全側＝表示する側に倒す）。
 */
export function filterHiddenJudgeRosterGroups(groups, hiddenLeafKeys) {
  if (!hiddenLeafKeys || !hiddenLeafKeys.length) return groups;
  const hidden = new Set(hiddenLeafKeys);
  return groups.filter(g => !g.leafKeys.every(k => hidden.has(k)));
}

// ============================================================
//  選手紹介ループ（display_control.html の進行役 / display.html の描画役、共用）
// ============================================================

/**
 * 選手紹介ループの手順を組み立てる。athletesは呼び出し側で既にクラス順に
 * ソート済みであること（クラスの切れ目はこの並び上で隣同士のclassが変わる箇所として検出する）。
 * showPerClassRoster が真の場合、各クラスの最後の選手の直後に、そのクラスの
 * 一覧ページ（type:'classRoster'）を挿入する。
 * display_control.html（進行のindex計算）とdisplay.html（実際の描画）の両方から呼び、
 * 同じ手順・同じ長さになることを保証する（ずれるとcurrentIndexの意味が食い違うため）。
 * @returns {Array<{type:'athlete', athlete:object} | {type:'classRoster', className:string, athletes:object[]}>}
 */
export function buildIntroSteps(athletes, showPerClassRoster) {
  const steps = [];
  athletes.forEach((a, i) => {
    steps.push({ type: 'athlete', athlete: a });
    if (!showPerClassRoster) return;
    const next = athletes[i + 1];
    // クラス・性別のどちらかが変わったら区切り（男女は別グループとして扱う）
    const groupChanging = !next ||
      (next.class || '') !== (a.class || '') || (next.gender || '') !== (a.gender || '');
    if (groupChanging) {
      const groupAthletes = athletes.filter(x =>
        (x.class || '') === (a.class || '') && (x.gender || '') === (a.gender || ''));
      const className = [a.class || '', a.gender || ''].filter(Boolean).join(' ');
      steps.push({ type: 'classRoster', className: className || '出場選手', athletes: groupAthletes });
    }
  });
  return steps;
}
