import Mark from './Mark.jsx';
import { P, isAdmin } from '../data/players.js';
import { standings, points } from '../game/ledger.js';

const ordinal = (n) => ['1st', '2nd', '3rd', '4th', '5th', '6th'][n - 1] || `${n}th`;

/**
 * Who is holding the phone, said plainly at the top of the page.
 *
 * Four people share this board and the seat is remembered across reloads, so
 * the failure mode is someone picking up a device and playing a whole game as
 * their sibling. The name is therefore in their own colour, next to their own
 * mark, above the fold — not tucked into a "Not Uzair?" link in the footer.
 */
export default function Welcome({ me, ledger, onSwitch }) {
  const player = P[me];
  if (!player) return null;

  const played = ledger.stats[me].p;
  const rank = standings(ledger).findIndex((s) => s.id === me) + 1;

  return (
    <section className="welcome" aria-label={`Signed in as ${player.name}`}>
      <Mark id={me} className="welcome-mark" />

      <div className="welcome-who">
        <p className="welcome-hi">{played ? 'Welcome back' : 'Welcome'}</p>
        <h2 className="welcome-name" style={{ color: player.color }}>
          {player.name}
          {isAdmin(me) && <span className="admin-tag">admin</span>}
        </h2>
      </div>

      <div className="welcome-stat">
        {played ? (
          <>
            <b>{points(ledger, me)}</b>
            <i>points · {ordinal(rank)} of four</i>
          </>
        ) : (
          <i>Your first game is waiting</i>
        )}
      </div>

      <button className="act ghost welcome-switch" onClick={onSwitch}>
        Not {player.name}?
      </button>
    </section>
  );
}
