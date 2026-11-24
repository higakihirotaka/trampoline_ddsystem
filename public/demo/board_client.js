// デモ用: 公開スコアへの書込は行わない（本物の board_client.js と同じ名前の、何もしない関数）
const noop = () => Promise.resolve();
export const boardPublish = noop, boardDns = noop, boardRemove = noop, boardSyncMeta = noop;
export const notice = () => {};
