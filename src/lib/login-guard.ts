const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const MAX_ENTRIES = 10000;

const failures = new Map<string, number[]>();

function pruneStale(timestamps: number[], now: number): number[] {
  const cutoff = now - WINDOW_MS;
  let i = 0;
  while (i < timestamps.length && timestamps[i] < cutoff) i++;
  return i > 0 ? timestamps.slice(i) : timestamps;
}

export function checkLocked(login: string): { locked: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const timestamps = pruneStale(failures.get(login) || [], now);
  if (timestamps.length >= MAX_FAILURES) {
    const oldest = timestamps[0];
    const retryAfterSec = Math.ceil((WINDOW_MS - (now - oldest)) / 1000);
    return { locked: true, retryAfterSec: Math.max(retryAfterSec, 1) };
  }
  return { locked: false };
}

export function recordFailure(login: string): void {
  const now = Date.now();
  const timestamps = pruneStale(failures.get(login) || [], now);
  timestamps.push(now);
  failures.set(login, timestamps);
  if (failures.size > MAX_ENTRIES) {
    const oldestKey = failures.keys().next().value;
    if (oldestKey !== undefined) failures.delete(oldestKey);
  }
}

export function recordSuccess(login: string): void {
  failures.delete(login);
}
