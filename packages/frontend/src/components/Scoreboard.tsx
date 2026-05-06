/**
 * Scoreboard with cumulative scores per player per round. The leader (lowest total)
 * is highlighted.
 */

import type { Player, PlayerId } from '@fwgin/shared';

export interface ScoreboardProps {
  players: Player[];
  scores: Record<PlayerId, number[]>;
  currentRound: number;
}

export function Scoreboard({ players, scores, currentRound }: ScoreboardProps) {
  const totals = new Map<PlayerId, number>();
  for (const p of players) {
    totals.set(
      p.id,
      (scores[p.id] ?? []).reduce((a, b) => a + b, 0),
    );
  }
  const min = Math.min(...totals.values());
  return (
    <div className="scoreboard">
      <table>
        <thead>
          <tr>
            <th>Player</th>
            {Array.from({ length: 13 }, (_, i) => (
              <th key={`r${i + 1}`} className={i + 1 === currentRound ? 'col-current' : ''}>
                {i + 1}
              </th>
            ))}
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {[...players]
            .sort((a, b) => a.seat - b.seat)
            .map((p) => {
              const rounds = scores[p.id] ?? [];
              const total = totals.get(p.id) ?? 0;
              const leader = total === min && total > 0;
              return (
                <tr key={p.id} className={leader ? 'leader' : ''}>
                  <td>{p.displayName}</td>
                  {Array.from({ length: 13 }, (_, i) => (
                    <td key={`${p.id}-r${i + 1}`}>{rounds[i] ?? ''}</td>
                  ))}
                  <td className="total">{total}</td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}
