/**
 * Tiny WebSocket wrapper with auto-reconnect and JSON message parsing.
 */

import type { ClientMsg, ServerMsg } from '@fwgin/shared';

export interface SocketHandle {
  send(msg: ClientMsg): void;
  close(): void;
  isOpen(): boolean;
}

export interface SocketOptions {
  onMessage(msg: ServerMsg): void;
  onOpen?(): void;
  onClose?(): void;
}

export function connectGameSocket(gameId: string, opts: SocketOptions): SocketHandle {
  let ws: WebSocket | null = null;
  let closed = false;
  let reconnectAttempts = 0;

  function open() {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/api/games/${gameId}/ws`;
    ws = new WebSocket(url);
    ws.addEventListener('open', () => {
      reconnectAttempts = 0;
      opts.onOpen?.();
      ws?.send(JSON.stringify({ type: 'hello' } satisfies ClientMsg));
    });
    ws.addEventListener('message', (e) => {
      try {
        const msg = JSON.parse(e.data) as ServerMsg;
        opts.onMessage(msg);
      } catch {
        /* ignore malformed */
      }
    });
    ws.addEventListener('close', () => {
      opts.onClose?.();
      if (closed) return;
      // Exponential backoff: 250ms, 500ms, 1s, 2s, 4s, then capped at 5s.
      const delay = Math.min(5000, 250 * 2 ** reconnectAttempts);
      reconnectAttempts++;
      setTimeout(open, delay);
    });
    ws.addEventListener('error', () => {
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    });
  }

  open();

  return {
    send(msg) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    },
    close() {
      closed = true;
      ws?.close();
    },
    isOpen() {
      return ws?.readyState === WebSocket.OPEN;
    },
  };
}
