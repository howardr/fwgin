/**
 * Bare-bones App shell. Phase 4 will replace this with the real router + game UI.
 */
import { useEffect, useState } from 'react';

interface Me {
  id: string;
  displayName: string;
}

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/me', { credentials: 'include' })
      .then((r) => r.json())
      .then(setMe)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <main className="container">
      <h1>Fort Worth Gin</h1>
      {error && <p className="error">{error}</p>}
      {me ? (
        <p>
          Hello, <strong>{me.displayName}</strong>
        </p>
      ) : (
        <p>Loading…</p>
      )}
      <p className="muted">
        The full game UI will land in the next milestone — for now this just verifies the Worker →
        DB session flow is healthy.
      </p>
    </main>
  );
}
