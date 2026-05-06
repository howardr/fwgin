/**
 * Tiny coloured dot that signals whether a given player currently has at least one
 * open WebSocket session to the game's Durable Object. Green = online, grey = offline.
 *
 * Online status is computed server-side in `GameDO` from the live WS session map and
 * pushed to every connected client whenever a player connects or disconnects, so all
 * seats see the same view at the same time.
 */

export function PresenceDot({ online }: { online: boolean }) {
  return (
    <span
      className={`presence-dot ${online ? 'on' : 'off'}`}
      title={online ? 'online' : 'offline'}
      aria-label={online ? 'online' : 'offline'}
    />
  );
}
