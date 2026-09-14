import { useEffect, useRef } from 'react';
import { IDLE_MS, isExpired, readActive, writeActive } from '../net/idle.js';

// Only the player's own input counts. A bot answering, or an opponent moving
// online, is not the person at this screen doing anything.
const INPUT = ['pointerdown', 'keydown', 'touchstart', 'wheel'];
const WRITE_EVERY = 10_000;   // don't hammer localStorage on every tap
const CHECK_EVERY = 15_000;

/**
 * Calls onExpire() once the player has been idle for `limit` ms.
 *
 * The expiry check runs BEFORE an input is counted as activity: a phone picked
 * up after an hour away must sign out on that first tap, not treat the tap as
 * proof of life and carry on.
 */
export default function useIdle({ enabled, onExpire, limit = IDLE_MS }) {
  const fire = useRef(onExpire);
  fire.current = onExpire;

  useEffect(() => {
    if (!enabled) return undefined;
    let lastWrite = 0;
    let gone = false;

    const expire = () => {
      if (gone) return;
      gone = true;
      fire.current();
    };

    const check = () => {
      if (isExpired(readActive(), Date.now(), limit)) expire();
    };

    const onInput = () => {
      check();
      if (gone) return;
      const now = Date.now();
      if (now - lastWrite >= WRITE_EVERY) {
        lastWrite = now;
        writeActive(now);
      }
    };

    // Waking from sleep or switching back to the tab: background timers may
    // not have run at all, so look at the clock straight away.
    const onWake = () => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') check();
    };

    INPUT.forEach((t) => window.addEventListener(t, onInput, { passive: true, capture: true }));
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    window.addEventListener('pageshow', onWake);
    const timer = setInterval(check, CHECK_EVERY);

    return () => {
      INPUT.forEach((t) => window.removeEventListener(t, onInput, { capture: true }));
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
      window.removeEventListener('pageshow', onWake);
      clearInterval(timer);
    };
  }, [enabled, limit]);
}
