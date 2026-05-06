/**
 * Thin API client. All requests use `credentials: 'include'` so the session cookie is
 * sent. Responses are JSON-parsed; non-OK responses throw with the API's error message.
 */

export interface Me {
  id: string;
  displayName: string;
}

export interface GameSummary {
  id: string;
  status: string;
  createdAt: number;
  hostId: string;
  inviteCode: string;
}

export interface GameLobby {
  id: string;
  hostId: string;
  status: string;
  config: {
    maxPlayers: number;
    turnTimerMs: number;
    discardVisibility: number;
    acesMode: 'low' | 'high' | 'either';
    layoffsOnOpponents: boolean;
    spectatorsAllowed: boolean;
  };
  inviteCode: string;
  createdAt: number;
  players: { id: string; seat: number; displayName: string; joinedAt: number }[];
  youAre: { kind: 'player'; id: string } | { kind: 'spectator' };
}

async function http<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...init });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    const e = (body as { error?: { message?: string } })?.error;
    throw new Error(e?.message ?? `HTTP ${res.status}`);
  }
  return body as T;
}

export const api = {
  config: () => http<{ vapidPublicKey: string }>('/api/config'),
  me: () => http<Me>('/api/me'),
  setName: (displayName: string) =>
    http<Me>('/api/me', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName }),
    }),
  createGame: (config: Partial<GameLobby['config']>) =>
    http<{ id: string; inviteCode: string; hostId: string }>('/api/games', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(config),
    }),
  getGame: (id: string) => http<GameLobby>(`/api/games/${id}`),
  joinGame: (id: string) =>
    http<{ joined: boolean; seat: number }>(`/api/games/${id}/join`, {
      method: 'POST',
    }),
  startGame: (id: string) =>
    http<{ started: boolean }>(`/api/games/${id}/start`, { method: 'POST' }),
  myGames: () => http<{ games: GameSummary[] }>('/api/games/mine'),
};
