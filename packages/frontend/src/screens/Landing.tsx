/**
 * Landing screen: set display name, create a game, or join via game id.
 */

import { useEffect, useState } from 'react';
import { type GameSummary, type Me, api } from '../lib/api.js';
import {
  getPushStatus,
  registerServiceWorker,
  subscribeToPush,
  unsubscribeFromPush,
} from '../lib/push.js';

export function Landing({ onNavigate }: { onNavigate(hash: string): void }) {
  const [me, setMe] = useState<Me | null>(null);
  const [name, setName] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [joinId, setJoinId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [my, setMy] = useState<GameSummary[]>([]);
  const [config, setConfig] = useState({
    maxPlayers: 4,
    turnTimerHours: 24,
    discardVisibility: 1,
    acesMode: 'high' as 'low' | 'high' | 'either',
  });
  const [vapidKey, setVapidKey] = useState('');
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushSupported, setPushSupported] = useState(false);

  useEffect(() => {
    api
      .me()
      .then(setMe)
      .catch((e) => setError(String(e)));
    api
      .myGames()
      .then((r) => setMy(r.games))
      .catch(() => undefined);
    api
      .config()
      .then((c) => setVapidKey(c.vapidPublicKey))
      .catch(() => undefined);
    registerServiceWorker().then(() => {
      getPushStatus().then((s) => {
        setPushSupported(s.supported);
        setPushSubscribed(s.subscribed && s.permission === 'granted');
      });
    });
  }, []);

  async function togglePush() {
    if (!vapidKey) return;
    if (pushSubscribed) {
      await unsubscribeFromPush();
      setPushSubscribed(false);
    } else {
      const ok = await subscribeToPush(vapidKey);
      setPushSubscribed(ok);
    }
  }

  async function saveName() {
    setBusy(true);
    try {
      const updated = await api.setName(name.trim() || me?.displayName || 'Player');
      setMe(updated);
      setEditingName(false);
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  async function createGame() {
    setBusy(true);
    setError(null);
    try {
      const g = await api.createGame({
        maxPlayers: config.maxPlayers as 2 | 3 | 4 | 5 | 6,
        turnTimerMs: config.turnTimerHours * 60 * 60 * 1000,
        discardVisibility: config.discardVisibility,
        acesMode: config.acesMode,
      });
      onNavigate(`#/games/${g.id}`);
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  async function joinGame() {
    if (!joinId.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.joinGame(joinId.trim());
      onNavigate(`#/games/${joinId.trim()}`);
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container">
      <header className="hero">
        <h1>Fort Worth Gin</h1>
        <p className="muted">
          Async multiplayer card game. 2–6 players, 13 rounds, lowest score wins.
        </p>
      </header>

      <section className="card-section">
        <h2>You</h2>
        {me ? (
          editingName ? (
            <div className="row">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={me.displayName}
                maxLength={40}
              />
              <button type="button" onClick={saveName} disabled={busy}>
                Save
              </button>
              <button type="button" onClick={() => setEditingName(false)} className="ghost">
                Cancel
              </button>
            </div>
          ) : (
            <div className="row">
              <span>
                Hello, <strong>{me.displayName}</strong>
              </span>
              <button
                type="button"
                onClick={() => {
                  setName(me.displayName);
                  setEditingName(true);
                }}
                className="ghost"
              >
                Change name
              </button>
            </div>
          )
        ) : (
          <p>Loading…</p>
        )}
        {pushSupported && vapidKey && (
          <div className="row" style={{ marginTop: '0.75rem' }}>
            <button type="button" onClick={togglePush} className={pushSubscribed ? '' : 'primary'}>
              {pushSubscribed ? 'Disable turn notifications' : 'Enable turn notifications'}
            </button>
            <span className="muted">
              {pushSubscribed
                ? "We'll notify you in this browser when it's your turn."
                : 'Get a push notification on your device when a game wants you.'}
            </span>
          </div>
        )}
      </section>

      <section className="card-section">
        <h2>Start a new game</h2>
        <div className="form-grid">
          <label>
            Max players
            <select
              value={config.maxPlayers}
              onChange={(e) => setConfig({ ...config, maxPlayers: Number(e.target.value) })}
            >
              {[2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label>
            Turn timer (hours)
            <input
              type="number"
              min={0.0167}
              step={0.5}
              value={config.turnTimerHours}
              onChange={(e) => setConfig({ ...config, turnTimerHours: Number(e.target.value) })}
            />
          </label>
          <label>
            Discard visibility
            <input
              type="number"
              min={1}
              max={52}
              value={config.discardVisibility}
              onChange={(e) => setConfig({ ...config, discardVisibility: Number(e.target.value) })}
            />
          </label>
          <label>
            Aces
            <select
              value={config.acesMode}
              onChange={(e) =>
                setConfig({
                  ...config,
                  acesMode: e.target.value as 'low' | 'high' | 'either',
                })
              }
            >
              <option value="high">high (Q-K-A only)</option>
              <option value="low">low (A-2-3 only)</option>
              <option value="either">either (A-2-3 or Q-K-A)</option>
            </select>
          </label>
        </div>
        <button type="button" className="primary" onClick={createGame} disabled={busy}>
          Create game
        </button>
      </section>

      <section className="card-section">
        <h2>Join with a code</h2>
        <div className="row">
          <input
            value={joinId}
            onChange={(e) => setJoinId(e.target.value.toLowerCase().trim())}
            placeholder="e.g. ab12cd34"
            maxLength={32}
          />
          <button type="button" onClick={joinGame} disabled={busy || !joinId.trim()}>
            Join
          </button>
        </div>
      </section>

      {my.length > 0 && (
        <section className="card-section">
          <h2>Your games</h2>
          <ul className="game-list">
            {my.map((g) => (
              <li key={g.id}>
                <a
                  href={`#/games/${g.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate(`#/games/${g.id}`);
                  }}
                >
                  <code>{g.id}</code> — <span className="muted">{g.status}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && <p className="error">{error}</p>}
    </main>
  );
}
