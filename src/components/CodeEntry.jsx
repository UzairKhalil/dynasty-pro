import { useRef, useState } from 'react';
import { playerByCode } from '../data/players.js';
import ChalkDefs from './ChalkDefs.jsx';

/**
 * Profile picker, not a login. The codes ship in the bundle and are readable by
 * anyone with devtools open — they exist so four people sharing a link land in
 * the right seat, nothing more.
 */
export default function CodeEntry({ onEnter, notice = null }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  function submit(e) {
    e.preventDefault();
    const player = playerByCode(code);
    if (!player) {
      setError(code.length < 5 ? 'Codes are five digits' : 'No player with that code');
      inputRef.current?.focus();
      return;
    }
    setError('');
    onEnter(player.id);
  }

  function change(e) {
    setCode(e.target.value.replace(/\D/g, '').slice(0, 5));
    if (error) setError('');
  }

  return (
    <div className="wrap">
      <ChalkDefs />
      <header className="masthead">
        <p className="eyebrow">Tic tac toe</p>
        <h1>Dynasty</h1>
        <p className="tagline">Four claimants. Nine squares. The throne changes hands weekly.</p>
      </header>

      <div className="gate">
        <form className="gate-card" onSubmit={submit}>
          {notice === 'idle' && (
            <p className="gate-notice" role="status">
              Signed out after 30 minutes without activity. Enter your code to carry on.
            </p>
          )}
          <h2>Who's playing?</h2>
          <p className="muted">Enter your five-digit player code to load your seat.</p>
          <input
            ref={inputRef}
            className={'code-input' + (error ? ' bad' : '')}
            id="code"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            placeholder="•••••"
            aria-label="Five-digit player code"
            aria-invalid={error ? 'true' : 'false'}
            value={code}
            onChange={change}
          />
          <p className="gate-err" role="alert">{error}</p>
          <button className="act" type="submit" style={{ width: '100%' }}>Take my seat</button>
          <div className="gate-hint">
            <p className="muted">
              Lost your code? It's the same five digits every time — ask whoever set the board up.
            </p>
            <p className="muted gate-privacy">
              Signing in records the time and basic device details — model, system, browser,
              screen — for the admin. Seats sign out after 30 minutes idle.
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
