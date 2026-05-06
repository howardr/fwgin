import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, addPlayerToLobby, newGameState } from '../src/factory.js';

describe('factory', () => {
  it('creates a new game with the host seated', () => {
    const s = newGameState({ id: 'g', hostId: 'h', hostName: 'Host', now: 1 });
    expect(s.players).toHaveLength(1);
    expect(s.players[0]?.seat).toBe(0);
    expect(s.phase).toBe('lobby');
    expect(s.config).toEqual(DEFAULT_CONFIG);
  });

  it('add player assigns the next seat', () => {
    const s = newGameState({ id: 'g', hostId: 'h', hostName: 'Host', now: 1 });
    addPlayerToLobby(s, 'p2', 'Two');
    addPlayerToLobby(s, 'p3', 'Three');
    expect(s.players.map((p) => p.seat)).toEqual([0, 1, 2]);
  });

  it('refuses to exceed maxPlayers', () => {
    const s = newGameState({
      id: 'g',
      hostId: 'h',
      hostName: 'Host',
      config: { maxPlayers: 2 },
      now: 1,
    });
    addPlayerToLobby(s, 'p2', 'Two');
    expect(() => addPlayerToLobby(s, 'p3', 'Three')).toThrow(/full/i);
  });

  it('idempotent on the same player id', () => {
    const s = newGameState({ id: 'g', hostId: 'h', hostName: 'Host', now: 1 });
    addPlayerToLobby(s, 'p2', 'Two');
    addPlayerToLobby(s, 'p2', 'Two');
    expect(s.players).toHaveLength(2);
  });
});
