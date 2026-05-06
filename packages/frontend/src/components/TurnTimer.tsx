/**
 * Live-updating turn timer. Re-renders every second and goes red when under 5 minutes.
 */

import { useEffect, useState } from 'react';

export function TurnTimer({ deadline }: { deadline: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const ms = deadline - now;
  if (ms <= 0) return <span className="timer expired">expired</span>;
  const cls = ms < 5 * 60_000 ? 'timer warning' : 'timer';
  return <span className={cls}>{formatRemaining(ms)}</span>;
}

function formatRemaining(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h ${m}m`;
  }
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}m ${sec}s`;
  }
  return `${s}s`;
}
