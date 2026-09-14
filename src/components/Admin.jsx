import { useState } from 'react';
import { P } from '../data/players.js';

/**
 * The admin card. Everything here is destructive and shared, so each control
 * arms on the first press and fires on the second — the same two-step the
 * ledger reset has always used.
 *
 * This is a UI permission, not a security boundary: the role lives in the
 * bundle alongside the codes, so it prevents accidents rather than intrusion.
 * The database rules in firebase.rules.json are what actually constrain writes.
 */
export default function Admin({ me, source, gameCount, onWipe, onClearPresence, online }) {
  const [armed, setArmed] = useState(null);

  function press(key, action) {
    if (armed !== key) {
      setArmed(key);
      setTimeout(() => setArmed((cur) => (cur === key ? null : cur)), 4000);
      return;
    }
    setArmed(null);
    action();
  }

  return (
    <div className="card admin-card">
      <h3>Admin · {P[me].name}<span className="admin-tag">full control</span></h3>

      <div className="choices">
        <button className="act ghost" onClick={() => press('wipe', onWipe)}>
          {armed === 'wipe' ? 'Tap again to wipe all records' : `Wipe ledger (${gameCount})`}
        </button>
        {online && (
          <button className="act ghost" onClick={() => press('presence', onClearPresence)}>
            {armed === 'presence' ? 'Tap again to clear' : 'Clear stale online marks'}
          </button>
        )}
      </div>

      <p className="notice">
        {source === 'cloud'
          ? 'The ledger is shared — wiping it clears the table for all four players, on every device.'
          : 'The ledger is on this device only, so wiping it affects nobody else.'}
        {' '}Strike a single game with the × beside it in Recent games.
      </p>
    </div>
  );
}
