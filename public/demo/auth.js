// デモ用: ログインは不要（管理者としてそのまま開く）
export const isLocalDev = false;
export function ensureAdmin(callback) { callback({ displayName: 'Demo', email: 'demo@example.com', uid: 'demo-uid' }); }
export function logout() { location.href = 'index.html'; }
export async function loginWithGoogle() { location.href = 'index.html'; }
