/**
 * Renders all melds laid on the table this round, grouped by owner. Each meld is
 * clickable so the active player can target it for layoffs or wild-stealing.
 */

import type { Meld, Player, PlayerId, Rank } from '@fwgin/shared';
import { rankOf } from '@fwgin/shared';
import { CardFace } from './Card.js';

export interface MeldAreaProps {
  melds: Meld[];
  players: Player[];
  wildRank: Rank | null;
  onMeldClick?(meldId: string): void;
  highlightMeldId?: string;
}

export function MeldArea({
  melds,
  players,
  wildRank,
  onMeldClick,
  highlightMeldId,
}: MeldAreaProps) {
  const byOwner = new Map<PlayerId, Meld[]>();
  for (const m of melds) {
    if (!byOwner.has(m.ownerId)) byOwner.set(m.ownerId, []);
    byOwner.get(m.ownerId)!.push(m);
  }
  return (
    <div className="meld-area">
      {[...byOwner.entries()].length === 0 && <p className="muted">No melds yet.</p>}
      {[...byOwner.entries()].map(([owner, list]) => {
        const player = players.find((p) => p.id === owner);
        return (
          <div key={owner} className="meld-row">
            <div className="meld-owner">{player?.displayName ?? owner}</div>
            <div className="melds">
              {list.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`meld ${m.id === highlightMeldId ? 'meld-highlight' : ''} ${
                    onMeldClick ? 'meld-clickable' : ''
                  }`}
                  onClick={onMeldClick ? () => onMeldClick(m.id) : undefined}
                  title={m.wildRepresents ? `Wild = ${m.wildRepresents}` : ''}
                >
                  {m.cards.map((c, i) => (
                    <CardFace
                      key={`${m.id}-${c}-${i}`}
                      card={c}
                      isWild={i === m.wildSlot || (wildRank !== null && rankOf(c) === wildRank)}
                      size="sm"
                    />
                  ))}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
