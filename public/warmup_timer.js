/**
 * 会場練習タイマー（warmupSettings）の共通計算・表示更新
 *
 * 方針: 書き込みは「開始・一時停止・リセット・時間設定」を押した瞬間の1回だけ。
 * 各端末（会場ディスプレイ・審判画面・審判用メニュー・操作画面）は読むだけで、
 * 自分で残り時間を計算する。操作PCが別ページへ移っても、会場ディスプレイが何台あっても、
 * リロードしても、誰かが定期的に書き込み続ける必要がない。
 *
 * warmupSettings のフィールド:
 *   timerRef         開始した時刻（サーバー時刻 = serverTimestamp）。開始のたびに1回だけ書く
 *   timerRemainingMs 開始時点（または一時停止時点）の残り時間
 *   timerPaused      一時停止/停止中か
 *   timerEndMs       書き込んだ端末自身の即時表示用（timerRef が確定するまでの一瞬だけ使う）
 *   timerRepeat      繰り返し
 *   timerDefaultMs   繰り返し時の1周の長さ
 */

// 繰り返しONのとき、0になってから次の周が始まるまでの間隔（従来どおり1.5秒）
export const WU_REPEAT_GAP_MS = 1500;
const WU_DEFAULT_MS = 5 * 60 * 1000;

/**
 * サーバー時刻 nowMs における残り時間を計算する（純粋関数）。
 *   rem     表示する残り時間(ms)
 *   running 動いている（0になった後の繰り返し待ち時間も true）。自然終了・停止中は false
 *   nextMs  表示（秒の数字、または繰り返しの待ち時間）が次に変わるまでの ms（running のときのみ）
 */
export function calcWarmupRem(w, nowMs, localNowMs = Date.now()) {
    if (!w) return { rem: 0, running: false };
    if (w.timerPaused) return { rem: w.timerRemainingMs ?? 0, running: false };
    const base = Math.max(0, w.timerRemainingMs ?? 0);
    if (w.timerRef?.toMillis) {
        const elapsed = Math.max(0, nowMs - w.timerRef.toMillis());
        if (elapsed < base) {
            const rem = base - elapsed;
            return { rem, running: true, nextMs: (rem % 1000) || 1000 };
        }
        if (!w.timerRepeat) return { rem: 0, running: false };
        // 繰り返し: 最初の周が終わったあと「待ち時間 → 1周 → 待ち時間 → 1周…」を計算で求める
        const dur = w.timerDefaultMs > 0 ? w.timerDefaultMs : WU_DEFAULT_MS;
        const cycle = dur + WU_REPEAT_GAP_MS;
        const p = (elapsed - base) % cycle;
        if (p < WU_REPEAT_GAP_MS) return { rem: 0, running: true, nextMs: WU_REPEAT_GAP_MS - p };
        const rem = cycle - p;
        return { rem, running: true, nextMs: (rem % 1000) || 1000 };
    }
    // timerRef 未確定（この端末が書き込んだ直後の一瞬）: この端末の時計で暫定表示
    if (w.timerEndMs != null) {
        const rem = Math.max(0, w.timerEndMs - localNowMs);
        return rem > 0
            ? { rem, running: true, nextMs: (rem % 1000) || 1000 }
            : { rem: 0, running: false };
    }
    return { rem: base, running: false };
}

// ---- サーバー時刻との差 ----
// サーバー時刻 ≒ Date.now() + _offset。HTTP の Date ヘッダ（秒単位）が「次の秒に切り替わった瞬間」を
// 短い間隔で何度も検出して求める。誤差は通信時間のゆらぎ込みで数十〜100ms程度。
let _offset = 0;
let _syncStarted = false;
const _syncListeners = new Set();

export function serverNow() { return Date.now() + _offset; }
export function getServerOffset() { return _offset; }

async function probeOnce() {
    const s = Date.now();
    const res = await fetch(`${location.pathname}?_=${s}`, { method: 'HEAD', cache: 'no-store' });
    const e = Date.now();
    const dh = res.headers.get('Date');
    const dateMs = dh ? new Date(dh).getTime() : NaN;
    if (isNaN(dateMs)) throw new Error('no Date header');
    return { mid: (s + e) / 2, dateMs };
}

export async function syncServerClock() {
    try {
        let prev = null;
        const est = [];
        const t0 = Date.now();
        while (Date.now() - t0 < 9000 && est.length < 5) {
            const cur = await probeOnce();
            if (!prev) {
                // 最初の1回だけで暫定値（誤差±0.5秒）。あとの測定で精度を上げる
                if (_offset === 0) { _offset = cur.dateMs + 500 - cur.mid; notifySync(); }
            } else if (cur.dateMs > prev.dateMs && cur.mid - prev.mid < 350) {
                // prev〜cur の間にサーバー時刻が cur.dateMs ちょうどになった
                est.push(cur.dateMs - (prev.mid + cur.mid) / 2);
            }
            prev = cur;
            await new Promise(r => setTimeout(r, 20));
        }
        if (est.length) {
            est.sort((a, b) => a - b);
            _offset = est[Math.floor(est.length / 2)];
            notifySync();
        }
    } catch { /* 取得できなければ現状のまま（初期値は端末の時計をそのまま使う） */ }
}

function notifySync() { _syncListeners.forEach(fn => { try { fn(); } catch {} }); }

export function ensureClockSync() {
    if (_syncStarted) return;
    _syncStarted = true;
    syncServerClock();
    setInterval(syncServerClock, 10 * 60 * 1000);
}

export function warmupRem(w) {
    return calcWarmupRem(w, serverNow());
}

/**
 * 残り時間の表示更新を、表示が変わる瞬間（秒の切り替わり）に合わせて行う。
 *   getW   最新の warmupSettings を返す関数
 *   render ({rem, running}) を受けて画面を更新する関数
 *   opts.keepAlive  true なら停止中も500msごとに状態を見続ける（常時表示用）
 * 戻り値: 停止用の関数
 */
export function startWarmupTicker(getW, render, opts = {}) {
    ensureClockSync();
    let timer = null, stopped = false;
    const step = () => {
        if (stopped) return;
        clearTimeout(timer);
        const s = warmupRem(getW());
        render(s);
        if (s.running) timer = setTimeout(step, Math.min(1000, (s.nextMs ?? 1000) + 5));
        else if (opts.keepAlive) timer = setTimeout(step, 500);
        else timer = null;
    };
    _syncListeners.add(step);
    const onVis = () => { if (typeof document !== 'undefined' && !document.hidden) step(); };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
    step();
    return () => {
        stopped = true;
        clearTimeout(timer);
        _syncListeners.delete(step);
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
    };
}
