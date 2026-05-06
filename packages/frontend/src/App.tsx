/**
 * Root app shell with very small hash-based routing:
 *   #/                     -> Landing
 *   #/games/:id            -> Game (lobby/table/end)
 */

import { useEffect, useState } from 'react';
import { Game } from './screens/Game.js';
import { Landing } from './screens/Landing.js';

function parseHash(): { name: 'home' } | { name: 'game'; id: string } | { name: 'unknown' } {
  const h = window.location.hash || '#/';
  if (h === '#/' || h === '#' || h === '') return { name: 'home' };
  const m = h.match(/^#\/games\/([a-zA-Z0-9]+)$/);
  if (m) return { name: 'game', id: m[1]! };
  return { name: 'unknown' };
}

export function App() {
  const [route, setRoute] = useState(parseHash);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  function navigate(hash: string) {
    if (window.location.hash === hash) {
      setRoute(parseHash());
    } else {
      window.location.hash = hash;
    }
  }

  if (route.name === 'home') return <Landing onNavigate={navigate} />;
  if (route.name === 'game') return <Game gameId={route.id} onNavigate={navigate} />;
  return (
    <main className="container">
      <p>Page not found.</p>
      <a href="#/">Home</a>
    </main>
  );
}
