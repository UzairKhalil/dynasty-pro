// Inactivity sign-out.
//
// The last-active time lives in localStorage rather than memory, for two
// reasons. A phone asleep in a pocket throttles or freezes timers, so an
// in-memory countdown would simply never fire; checking a stored timestamp on
// wake-up does. And a seat remembered from yesterday must ask for the code
// again on the next visit, which only a stored timestamp can know.

export const IDLE_MS = 30 * 60 * 1000;
export const ACTIVE_KEY = 'dynasty:active';

/** Pure. No timestamp at all counts as expired: we cannot vouch for it. */
export const isExpired = (last, now = Date.now(), limit = IDLE_MS) =>
  !Number.isFinite(+last) || !last || now - +last >= limit;

export function readActive() {
  try {
    const v = window.localStorage.getItem(ACTIVE_KEY);
    return v ? +v : 0;
  } catch {
    return 0;
  }
}

export function writeActive(t = Date.now()) {
  try {
    if (t) window.localStorage.setItem(ACTIVE_KEY, String(t));
    else window.localStorage.removeItem(ACTIVE_KEY);
  } catch { /* private mode: the session just lasts as long as the tab */ }
}
