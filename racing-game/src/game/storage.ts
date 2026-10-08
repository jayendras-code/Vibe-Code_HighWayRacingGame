import { CONFIG } from "./config";

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function getHighScore(): number {
  if (!canUseStorage()) return 0;
  try {
    const raw = window.localStorage.getItem(CONFIG.storageKey);
    const parsed = raw == null ? 0 : Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
  } catch {
    return 0;
  }
}

export function saveHighScore(score: number): number {
  const next = Math.max(0, Math.floor(score));
  const prev = getHighScore();
  const best = Math.max(prev, next);
  if (!canUseStorage()) return best;
  try {
    window.localStorage.setItem(CONFIG.storageKey, String(best));
  } catch {
    // Storage may be blocked (private mode, quotas). Keep the in-memory best.
  }
  return best;
}
