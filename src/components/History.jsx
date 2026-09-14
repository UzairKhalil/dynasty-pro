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
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  } catch {
    return new Date(at).toISOString();
  }
};

const REASON = { idle: 'signed out · idle', manual: 'signed out' };

const blank = (v) => v === undefined || v === null || v === '' || v === 0;
const show = (v) => (blank(v) ? '—' : String(v));

// One column per device detail. The order runs from what identifies a device
// (model, system, browser) to what only describes it (cores, network, locale).
const DEVICE_COLUMNS = [
  ['Type', (d) => d.type],
  ['Model', (d) => d.model],
  ['System', (d) => d.os],
  ['Browser', (d) => d.browser],
  ['Screen', (d) => d.screen && `${d.screen} @${d.dpr}x`],
  ['Window', (d) => d.viewport],
  ['Touch', (d) => d.touch],
  ['Cores', (d) => d.cores],
  ['Memory', (d) => d.memory && `${d.memory} GB`],
  ['Network', (d) => d.net],
  ['Language', (d) => d.lang],
  ['Time zone', (d) => d.tz],
  ['Installed', (d) => (d.installed ? 'yes' : 'no')]
];

function Player({ id }) {
  const p = P[id];
  return (
    <span className="cell-player">
      <Mark id={id} className="who-mark" />
      <span className="who-name" style={{ color: p?.color }}>{p?.name || id}</span>
    </span>
  );
}

/**
 * Sign-ins as a table. It is wider than any phone, so it scrolls sideways
 * inside its own box — the page never does — and the Player column stays
 * pinned, so a row is still attributable while you read across to its
 * time zone.
 */
export default function History({ onBack }) {
  const [entries, setEntries] = useState(null);
  const [source, setSource] = useState('cloud');
  const [failed, setFailed] = useState(false);
  const [who, setWho] = useState('all');
  const [armed, setArmed] = useState(false);

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

  // The first sign-in ever seen from each player's device.
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
      const cur = map.get(k);
      if (!cur) map.set(k, { latest: e, count: e.kind === 'in' ? 1 : 0 });   // newest first
      else if (e.kind === 'in') cur.count += 1;
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
          <h3 className="panel-title history-h">Devices seen</h3>
          {devices.length === 0 ? (
            <p className="empty">Nobody has signed in yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table devices-table">
                <thead>
                  <tr>
                    <th className="sticky">Player</th>
                    <th>Device</th>
                    <th>Sign-ins</th>
                    <th>Last seen</th>
                    <th>Device id</th>
                  </tr>
                </thead>
                <tbody>
                  {devices.map(({ latest: e, count }) => (
                    <tr key={`${e.player}:${e.deviceId}`} className="device-row">
                      <td className="sticky"><Player id={e.player} /></td>
                      <td>{e.device.label || 'Unknown device'}</td>
                      <td className="num">{count}</td>
                      <td title={stamp(e.at)}>{ago(e.at, now)}</td>
                      <td className="dim">{e.deviceId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="history-bar">
            <h3 className="panel-title history-h">All sign-ins</h3>
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
          </div>

          {shown.length === 0 ? (
            <p className="empty">No sign-ins recorded{who !== 'all' ? ` for ${P[who].name}` : ''}.</p>
          ) : (
            <>
              <p className="scroll-hint" aria-hidden="true">Scroll sideways for every device detail &rarr;</p>
              <div className="table-wrap" tabIndex={0} role="region" aria-label="Sign-in history table">
                <table className="data-table login-table">
                  <thead>
                    <tr>
                      <th className="sticky">Player</th>
                      <th>When</th>
                      <th>Event</th>
                      <th>Device</th>
                      {DEVICE_COLUMNS.map(([label]) => <th key={label}>{label}</th>)}
                      <th>Device id</th>
                      <th>User agent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((e) => {
                      const d = e.device || {};
                      return (
                        <tr key={e.id} className={'login ' + (e.kind === 'out' ? 'login-out' : 'login-in')}>
                          <td className="sticky"><Player id={e.player} /></td>
                          <td title={stamp(e.at)}>
                            <span className="when-ago">{ago(e.at, now)}</span>
                            <span className="when-at">{stamp(e.at)}</span>
                          </td>
                          <td className="login-kind">
                            {e.kind === 'in' ? 'signed in' : (REASON[e.reason] || 'signed out')}
                            {firstSeen.has(e.id) && <span className="login-new">new device</span>}
                          </td>
                          <td className="login-device">{d.label || 'Unknown device'}</td>
                          {DEVICE_COLUMNS.map(([label, get]) => (
                            <td key={label} className={blank(get(d)) ? 'dim' : undefined}>{show(get(d))}</td>
                          ))}
                          <td className="dim">{show(e.deviceId)}</td>
                          <td className="ua" title={d.ua || ''}>{show(d.ua)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
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
