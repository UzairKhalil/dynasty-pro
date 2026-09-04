import { Component } from 'react';

/**
 * Without this, any thrown render error unmounts the whole tree and the
 * visitor gets a blank page with the reason buried in a console they will
 * never open. On a published static site that is indistinguishable from the
 * deploy being broken.
 *
 * The saved ledger is the one thing worth protecting here, so the recovery
 * offered is a reload — never a storage wipe.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[dynasty] render failed:', error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="wrap">
        <header className="masthead">
          <p className="eyebrow">Tic tac toe</p>
          <h1>Dynasty</h1>
        </header>
        <div className="card" style={{ maxWidth: 520 }}>
          <h3>Something broke</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            The board hit an error and stopped rendering. Your saved games are untouched.
          </p>
          <pre style={{
            fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--chalk-dim)',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: '14px 0'
          }}>
            {String(error?.message || error)}
          </pre>
          <div className="choices">
            <button className="act" onClick={() => window.location.reload()}>Reload</button>
          </div>
        </div>
      </div>
    );
  }
}
