import { useEffect, useMemo, useState } from 'react';
import Mark from './Mark.jsx';
import { PLAYERS, P } from '../data/players.js';
import { watchLogins, clearLogins, CAP } from '../net/logins.js';

export function ago(at, now = Date.now()) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

const stamp = (at) => {
  try {
    return new Date(at).toLocaleString(undefined, {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
    });
  } catch {
    return new Date(at).toISOString();
  }
};

const REASON = { idle: 'signed out · 30 min idle', manual: 'signed out' };

/**
 * One device per player at a glance, then every sign-in newest first. Built as
 * a stack of cards rather than a table: a table with ten device columns is
 * unreadable on the phone this is most likely to be opened on.
 */
export default function History({ onBack }) {
  const [entries, setEntries] = useState(null);
  const [source, setSource] = useState('cloud');
  const [who, setWho] = useState('all');
  const [armed, setArmed] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stop = null;
    let dead = false;
    watchLogins((list) => { if (!dead) setEntries(list); },
                () => { if (!dead) setFailed(true); }).then((h) => {
      if (dead) { h.stop(); return; }
      stop = h.stop;
      setSource(h.source);
    });
    return () => { dead = true; if (stop) stop(); };
  }, []);

  // Which sign-ins were the first ever seen from that device for that player.
  const firstSeen = useMemo(() => {
    const seen = new Set();
    const first = new Set();
    [...(entries || [])].reverse().forEach((e) => {
      if (e.kind !== 'in') return;
      const k = `${e.player}:${e.deviceId}`;
      if (!seen.has(k)) { seen.add(k); first.add(e.id); }
    });
    return first;
  }, [entries]);

  const devices = useMemo(() => {
    const map = new Map();
    (entries || []).forEach((e) => {
      if (!e.deviceId) return;
      const k = `${e.player}:${e.deviceId}`;
      if (!map.has(k)) map.set(k, e);           // entries are newest first
    });
    return [...map.values()];
  }, [entries]);

  const shown = (entries || []).filter((e) => who === 'all' || e.player === who);
  const now = Date.now();

  function clear() {
    if (!armed) {
      setArmed(true);
      setTimeout(() => setArmed(false), 4000);
      return;
    }
    setArmed(false);
    clearLogins();
  }

  return (
    <div className="history" id="history">
      <div className="play-top history-top">
        <button className="play-back" onClick={onBack}>&larr; Lobby</button>
        <span className="pill">Admin</span>
      </div>

      <h2 className="history-title">Sign-in history</h2>
      <p className="muted history-lede">
        Every sign-in and sign-out, with what each browser reports about its device.
      </p>

      {entries === null ? (
        <p className="empty">Loading…</p>
      ) : (
        <>
          <div className="card history-card">
            <h3>Devices seen</h3>
            {devices.length === 0 ? (
              <p className="empty">Nobody has signed in yet.</p>
            ) : (
              <ul className="device-list">
                {devices.map((e) => (
                  <li key={`${e.player}:${e.deviceId}`} className="device-row">
                    <Mark id={e.player} className="who-mark" />
                    <span className="device-id">
                      <span className="who-name" style={{ color: P[e.player]?.color }}>
                        {P[e.player]?.name || e.player}
                      </span>
                      <span className="device-label">{e.device.label || 'Unknown device'}</span>
                    </span>
                    <span className="device-seen">{ago(e.at, now)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="choices history-filter" role="group" aria-label="Filter by player">
            <button className="chip" aria-pressed={who === 'all'} onClick={() => setWho('all')}>
              Everyone ({entries.length})
            </button>
            {PLAYERS.map((p) => (
              <button key={p.id} className="chip" aria-pressed={who === p.id}
                      onClick={() => setWho(p.id)}>
                {p.name}
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <p className="empty">No sign-ins recorded{who !== 'all' ? ` for ${P[who].name}` : ''}.</p>
          ) : (
            <ol className="login-list">
              {shown.map((e) => {
                const d = e.device || {};
                const p = P[e.player];
                return (
                  <li key={e.id} className={'login ' + (e.kind === 'out' ? 'login-out' : 'login-in')}>
                    <div className="login-head">
                      <Mark id={e.player} className="who-mark" />
                      <span className="login-who">
                        <span className="who-name" style={{ color: p?.color }}>{p?.name || e.player}</span>
                        <span className="login-kind">
                          {e.kind === 'in' ? 'signed in' : (REASON[e.reason] || 'signed out')}
                          {firstSeen.has(e.id) && <span className="login-new">new device</span>}
                        </span>
                      </span>
                      <span className="login-when" title={stamp(e.at)}>
                        <b>{ago(e.at, now)}</b>
                        <i>{stamp(e.at)}</i>
                      </span>
                    </div>
                    <div className="login-device">{d.label || 'Unknown device'}</div>
                    <details className="login-more">
                      <summary>Device details</summary>
                      <dl>
                        {[
                          ['Type', d.type],
                          ['Model', d.model],
                          ['System', d.os],
                          ['Browser', d.browser],
                          ['Screen', d.screen && `${d.screen} @${d.dpr}x`],
                          ['Window', d.viewport],
                          ['Touch points', d.touch],
                          ['CPU cores', d.cores],
                          ['Memory', d.memory && `${d.memory} GB`],
                          ['Network', d.net],
                          ['Language', d.lang],
                          ['Time zone', d.tz],
                          ['Installed app', d.installed ? 'yes' : 'no'],
                          ['Device id', e.deviceId]
                        ].filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== 0)
                          .map(([k, v]) => (
                            <div key={k} className="kv"><dt>{k}</dt><dd>{String(v)}</dd></div>
                          ))}
                        {d.ua && (
                          <div className="kv kv-wide"><dt>User agent</dt><dd>{d.ua}</dd></div>
                        )}
                      </dl>
                    </details>
                  </li>
                );
              })}
            </ol>
          )}

          <p className="notice">
            {failed
              ? 'Could not read the shared history — the database rules may not cover sign-ins yet — so this is only what was recorded on this device. '
              : source === 'cloud'
                ? 'Shared across every device. '
                : 'No realtime service is reachable, so only sign-ins on this device are listed. '}
            Keeps the newest {CAP} entries. Stored without authentication, so "admin only" is a
            screen, not a lock — anyone who can read the database can read this.
          </p>

          <div className="choices">
            <button className="act ghost" onClick={clear} disabled={!entries.length}>
              {armed ? 'Tap again to clear history' : 'Clear history'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
