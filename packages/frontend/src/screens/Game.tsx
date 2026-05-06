/**
 * Game screen — handles lobby, active table, and game-over views, all driven by the
 * latest GameView from the WebSocket.
 */

import type { Card as CardId, ClientMsg, PlayerView, Rank, ViewForClient } from '@fwgin/shared';
import { useEffect, useState } from 'react';
import { Hand } from '../components/Hand.js';
import { MeldArea } from '../components/MeldArea.js';
import { Pile } from '../components/Pile.js';
import { Scoreboard } from '../components/Scoreboard.js';
import { TurnTimer } from '../components/TurnTimer.js';
import { useGameSocket } from '../hooks/useGameSocket.js';
import { type GameLobby, api } from '../lib/api.js';

export function Game({ gameId, onNavigate }: { gameId: string; onNavigate(hash: string): void }) {
  const [lobby, setLobby] = useState<GameLobby | null>(null);
  const [lobbyError, setLobbyError] = useState<string | null>(null);
  const { view, connected, error, send, chat } = useGameSocket(gameId);
  const [selected, setSelected] = useState<CardId[]>([]);

  useEffect(() => {
    api
      .getGame(gameId)
      .then(setLobby)
      .catch((e) => setLobbyError(String(e.message)));
  }, [gameId]);

  // When the round changes (or a new game starts), clear the selection.
  // biome-ignore lint/correctness/useExhaustiveDependencies: setSelected is stable
  useEffect(() => {
    setSelected([]);
  }, [view?.round, view?.phase]);

  if (lobbyError) {
    return (
      <main className="container">
        <p className="error">{lobbyError}</p>
        <button type="button" onClick={() => onNavigate('#/')}>
          Back
        </button>
      </main>
    );
  }
  if (!lobby) {
    return (
      <main className="container">
        <p>Loading…</p>
      </main>
    );
  }

  // Lobby (game has not started yet).
  if (lobby.status === 'lobby') {
    return (
      <Lobby
        gameId={gameId}
        lobby={lobby}
        onStart={async () => {
          try {
            await api.startGame(gameId);
            // The WS will push us a state update.
          } catch (e) {
            setLobbyError(String((e as Error).message));
          }
        }}
        onBack={() => onNavigate('#/')}
      />
    );
  }

  return (
    <Table
      lobby={lobby}
      view={view}
      connected={connected}
      error={error}
      send={send}
      chat={chat}
      selected={selected}
      setSelected={setSelected}
      onBack={() => onNavigate('#/')}
    />
  );
}

function Lobby({
  gameId,
  lobby,
  onStart,
  onBack,
}: {
  gameId: string;
  lobby: GameLobby;
  onStart(): void;
  onBack(): void;
}) {
  const isHost = lobby.youAre.kind === 'player' && lobby.youAre.id === lobby.hostId;
  const inviteUrl = `${window.location.origin}/#/games/${gameId}`;
  const [copied, setCopied] = useState(false);

  return (
    <main className="container">
      <header className="row">
        <button type="button" onClick={onBack} className="ghost">
          ← Home
        </button>
        <h1>Lobby</h1>
      </header>
      <section className="card-section">
        <h2>Invite</h2>
        <p className="muted">Share this link to invite players or spectators:</p>
        <div className="row">
          <input value={inviteUrl} readOnly />
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(inviteUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </section>
      <section className="card-section">
        <h2>
          Players ({lobby.players.length}/{lobby.config.maxPlayers})
        </h2>
        <ul className="player-list">
          {lobby.players.map((p) => (
            <li key={p.id}>
              {p.displayName}
              {p.id === lobby.hostId && <span className="badge">host</span>}
            </li>
          ))}
        </ul>
      </section>
      <section className="card-section">
        <h2>Settings</h2>
        <ul className="muted">
          <li>Max players: {lobby.config.maxPlayers}</li>
          <li>Turn timer: {Math.round(lobby.config.turnTimerMs / 3_600_000)}h</li>
          <li>Discard visibility: top {lobby.config.discardVisibility}</li>
          <li>Aces: {lobby.config.acesMode}</li>
          <li>
            Layoffs onto opponents:{' '}
            {lobby.config.layoffsOnOpponents ? 'allowed (after own meld)' : 'disabled'}
          </li>
          <li>Spectators: {lobby.config.spectatorsAllowed ? 'allowed' : 'disabled'}</li>
        </ul>
      </section>
      {isHost ? (
        <button
          type="button"
          className="primary"
          onClick={onStart}
          disabled={lobby.players.length < 2}
        >
          Start game
        </button>
      ) : (
        <p className="muted">Waiting for the host to start the game…</p>
      )}
    </main>
  );
}

interface TableProps {
  lobby: GameLobby;
  view: ViewForClient | null;
  connected: boolean;
  error: string | null;
  send: (msg: ClientMsg) => void;
  chat: { fromName: string; text: string; at: number }[];
  selected: CardId[];
  setSelected: (s: CardId[]) => void;
  onBack(): void;
}

function Table({
  lobby,
  view,
  connected,
  error,
  send,
  chat,
  selected,
  setSelected,
  onBack,
}: TableProps) {
  if (!view) {
    return (
      <main className="container">
        <p>Connecting…</p>
        {error && <p className="error">{error}</p>}
      </main>
    );
  }

  const isPlayer = view.kind === 'player';
  const yourId = isPlayer ? (view as PlayerView).yourId : null;
  const yourSeat = isPlayer ? (view.players.find((p) => p.id === yourId)?.seat ?? -1) : -1;
  const isYourTurn = isPlayer && yourSeat === view.turnSeat;
  const currentPlayer = view.players.find((p) => p.seat === view.turnSeat);

  function toggleSelected(c: CardId) {
    if (selected.includes(c)) setSelected(selected.filter((x) => x !== c));
    else setSelected([...selected, c]);
  }

  function send_<M extends ClientMsg['type']>(type: M, extra?: object) {
    send({ type, ...(extra ?? {}) } as ClientMsg);
  }

  function layMeld() {
    if (selected.length < 3) return;
    const wildSlot = selected.findIndex((c) => view!.wildRank !== null && c[0] === view!.wildRank);
    let wildRepresents: string | undefined;
    if (wildSlot !== -1) {
      const input = window.prompt(
        'This meld contains a wild. What card does it represent? (e.g. 7H)',
      );
      if (!input) return;
      wildRepresents = input.trim().toUpperCase();
    }
    send_('lay_meld', {
      cards: selected,
      wildSlot: wildSlot === -1 ? undefined : wildSlot,
      wildRepresents,
    });
    setSelected([]);
  }

  function discard() {
    if (selected.length !== 1) return;
    send_('discard', { card: selected[0] });
    setSelected([]);
  }

  function extendMeld(meldId: string) {
    if (selected.length === 0) return;
    const wildSlot = selected.findIndex((c) => view!.wildRank !== null && c[0] === view!.wildRank);
    let wildRepresents: string | undefined;
    if (wildSlot !== -1) {
      const input = window.prompt('Adding a wild. What card does it represent? (e.g. 7H)');
      if (!input) return;
      wildRepresents = input.trim().toUpperCase();
    }
    send_('extend_meld', {
      meldId,
      cards: selected,
      wildSlot: wildSlot === -1 ? undefined : wildSlot,
      wildRepresents,
    });
    setSelected([]);
  }

  function stealWild(meldId: string) {
    const meld = view!.meldsOnTable.find((m) => m.id === meldId);
    if (!meld?.wildRepresents) return;
    if (!window.confirm(`Surrender ${meld.wildRepresents} to take the wild?`)) return;
    send_('steal_wild', { meldId, surrender: meld.wildRepresents });
  }

  return (
    <main className="container container-wide">
      <header className="row table-header">
        <button type="button" onClick={onBack} className="ghost">
          ← Home
        </button>
        <div className="banner">
          <strong>Round {view.round} of 13</strong>
          <span className="sep">•</span>
          <span>
            Wild: <span className="wild-pill">{view.wildRank}</span>
          </span>
          <span className="sep">•</span>
          {view.phase === 'game_over' ? (
            <span>Game over</span>
          ) : view.phase === 'awaiting_upcard' ? (
            <span>
              {currentPlayer?.displayName} considering upcard…{' '}
              <TurnTimer deadline={view.turnDeadline} />
            </span>
          ) : (
            <span>
              {currentPlayer?.displayName}'s turn — <TurnTimer deadline={view.turnDeadline} />
            </span>
          )}
        </div>
        <span
          className={`status-dot ${connected ? 'on' : 'off'}`}
          title={connected ? 'connected' : 'reconnecting'}
        />
      </header>

      {error && <p className="error">{error}</p>}

      <section className="card-section">
        <h2>Players</h2>
        <ul className="players-row">
          {[...view.players]
            .sort((a, b) => a.seat - b.seat)
            .map((p) => (
              <li
                key={p.id}
                className={`player ${p.seat === view.turnSeat ? 'turn' : ''} ${p.id === yourId ? 'self' : ''}`}
              >
                <span className="player-name">{p.displayName}</span>
                <span className="player-info">
                  {p.handCount} card{p.handCount === 1 ? '' : 's'}
                  {p.id === lobby.hostId && <span className="badge">host</span>}
                  {!p.online && <span className="badge muted">offline</span>}
                </span>
              </li>
            ))}
        </ul>
      </section>

      <section className="card-section">
        <h2>Table</h2>
        <Pile
          stockCount={view.stockCount}
          discard={view.discard}
          discardTotal={view.discardTotal}
          onDrawStock={
            isYourTurn && view.phase === 'in_round' ? () => send_('draw_stock') : undefined
          }
          onDrawDiscard={
            isYourTurn && view.phase === 'in_round' ? () => send_('draw_discard') : undefined
          }
        />
        <MeldArea
          melds={view.meldsOnTable}
          players={view.players}
          wildRank={view.wildRank}
          onMeldClick={
            isYourTurn && view.phase === 'in_round'
              ? (id) => {
                  // Decide based on context: if we have selection, attempt to extend; if meld
                  // has a wild and we hold the natural, try to steal.
                  if (selected.length > 0) extendMeld(id);
                  else stealWild(id);
                }
              : undefined
          }
        />
      </section>

      {isPlayer && (
        <section className="card-section">
          <h2>Your hand</h2>
          <Hand
            hand={(view as PlayerView).yourHand}
            selected={selected}
            wildRank={view.wildRank as Rank | null}
            onToggle={toggleSelected}
          />
          <div className="actions">
            {view.phase === 'awaiting_upcard' && isYourTurn && (
              <>
                <button type="button" className="primary" onClick={() => send_('accept_upcard')}>
                  Take upcard
                </button>
                <button type="button" onClick={() => send_('decline_upcard')}>
                  Pass
                </button>
              </>
            )}
            {view.phase === 'in_round' && isYourTurn && (
              <>
                <button
                  type="button"
                  onClick={layMeld}
                  disabled={selected.length < 3}
                  title="Select 3+ cards to lay a meld"
                >
                  Lay meld ({selected.length})
                </button>
                <button
                  type="button"
                  onClick={discard}
                  disabled={selected.length !== 1}
                  title="Select exactly 1 card to discard"
                >
                  Discard
                </button>
                {selected.length > 0 && (
                  <button type="button" className="ghost" onClick={() => setSelected([])}>
                    Clear selection
                  </button>
                )}
              </>
            )}
          </div>
        </section>
      )}

      <section className="card-section">
        <h2>Scoreboard</h2>
        <Scoreboard players={view.players} scores={view.scores} currentRound={view.round} />
      </section>

      <section className="card-section">
        <h2>Recent activity</h2>
        <ul className="event-log">
          {view.recentEvents
            .slice(-15)
            .reverse()
            .map((e, i) => (
              <li key={`${e.at}-${i}`}>
                <span className="event-time">{new Date(e.at).toLocaleTimeString()}</span>{' '}
                {describeEvent(e, view.players)}
              </li>
            ))}
        </ul>
      </section>

      {chat.length > 0 && (
        <section className="card-section">
          <h2>Chat</h2>
          <ul className="chat">
            {chat.map((c, i) => (
              <li key={`${c.at}-${i}`}>
                <strong>{c.fromName}:</strong> {c.text}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function describeEvent(
  e: PlayerView['recentEvents'][number],
  players: PlayerView['players'],
): string {
  function name(id: string) {
    return players.find((p) => p.id === id)?.displayName ?? id;
  }
  switch (e.type) {
    case 'game_started':
      return 'Game started.';
    case 'round_started':
      return `Round ${e.round} started — wild is ${e.wildRank}, dealer is ${name(e.dealerId)}.`;
    case 'upcard_offered':
      return `${name(e.toPlayerId)} was offered the upcard ${e.card}.`;
    case 'upcard_accepted':
      return `${name(e.byPlayerId)} took the upcard ${e.card}.`;
    case 'upcard_declined':
      return `${name(e.byPlayerId)} passed on the upcard.`;
    case 'wild_stolen':
      return `${name(e.byPlayerId)} stole a wild and surrendered ${e.surrendered}.`;
    case 'drew_stock':
      return `${name(e.playerId)} drew from the stock.`;
    case 'drew_discard':
      return `${name(e.playerId)} took ${e.card} from the discard.`;
    case 'meld_laid':
      return `${name(e.playerId)} laid a meld: ${e.cards.join(' ')}.`;
    case 'meld_extended':
      return `${name(e.playerId)} extended a meld with ${e.cards.join(' ')}.`;
    case 'discarded':
      return `${name(e.playerId)} discarded ${e.card}.`;
    case 'stock_reshuffled':
      return 'Stock was reshuffled from the discard.';
    case 'auto_played':
      return `${name(e.playerId)}'s turn timer expired — auto-played ${e.discarded}.`;
    case 'round_ended':
      return e.winnerId
        ? `${name(e.winnerId)} went out and won the round.`
        : 'Round ended (no winner).';
    case 'game_ended':
      return `Game over. Winner: ${e.winnerIds.map(name).join(', ')}.`;
    default:
      return JSON.stringify(e);
  }
}
