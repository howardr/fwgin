/**
 * React hook that owns a WebSocket connection to one game and surfaces the latest
 * `ViewForClient` snapshot, recent events, and a `send()` function.
 */

import type { ClientMsg, ServerMsg, ViewForClient } from '@fwgin/shared';
import { useEffect, useRef, useState } from 'react';
import { type SocketHandle, connectGameSocket } from '../lib/socket.js';

export interface UseGameSocketResult {
  view: ViewForClient | null;
  connected: boolean;
  error: string | null;
  send(msg: ClientMsg): void;
  chat: { fromName: string; text: string; at: number }[];
}

export function useGameSocket(gameId: string | null): UseGameSocketResult {
  const [view, setView] = useState<ViewForClient | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chat, setChat] = useState<{ fromName: string; text: string; at: number }[]>([]);
  const handleRef = useRef<SocketHandle | null>(null);

  useEffect(() => {
    if (!gameId) return undefined;
    setError(null);
    const h = connectGameSocket(gameId, {
      onOpen: () => setConnected(true),
      onClose: () => setConnected(false),
      onMessage: (msg: ServerMsg) => {
        switch (msg.type) {
          case 'state':
            setView(msg.view as ViewForClient);
            break;
          case 'event':
            // Currently we only render via state snapshots; events could drive
            // toasts/animations in the future.
            break;
          case 'error':
            setError(`${msg.code}: ${msg.message}`);
            // Auto-clear after a few seconds.
            setTimeout(() => setError((cur) => (cur?.startsWith(msg.code) ? null : cur)), 4000);
            break;
          case 'chat':
            setChat((c) => [
              ...c.slice(-49),
              { fromName: msg.fromName, text: msg.text, at: msg.at },
            ]);
            break;
          case 'hello_ack':
            // Future: surface "youAre" to the UI.
            break;
        }
      },
    });
    handleRef.current = h;
    return () => {
      h.close();
      handleRef.current = null;
    };
  }, [gameId]);

  return {
    view,
    connected,
    error,
    chat,
    send: (msg) => handleRef.current?.send(msg),
  };
}
