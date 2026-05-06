# Fort Worth Gin — Rules (canonical for this implementation)

This document is the source of truth for the engine. If you change a rule here, the engine
and tests need to change with it.

## Players & deck

- 2 to 6 players.
- One standard 52-card deck. No jokers.

## Setup per round

- Each player is dealt **7 cards**.
- The player to the dealer's left (the first to play) is dealt **one extra card**, for
  a starting hand of **8**. This stands in for the first player's draw step on their
  opening turn — they begin the round already "drawn".
- The discard pile starts **empty**. No upcard is turned.
- Remaining cards form the stock, face-down.
- The dealer rotates clockwise each round.
- Round 1's dealer is chosen at random.

## Rounds and the wild card

- A game is **13 rounds**. Each round designates one rank as the **wild rank**:

  | Round | Wild |
  |-------|------|
  | 1     | 2    |
  | 2     | 3    |
  | 3     | 4    |
  | 4     | 5    |
  | 5     | 6    |
  | 6     | 7    |
  | 7     | 8    |
  | 8     | 9    |
  | 9     | 10   |
  | 10    | J    |
  | 11    | Q    |
  | 12    | K    |
  | 13    | A    |

## Turn structure

On your turn, in order:

1. **Optional — Steal a wild.** If a wild has been laid in any meld on the table and you hold
   the **exact natural card** that wild was declared to represent, you may surrender that
   natural card to the meld and take the wild into your hand. Limit one steal per turn.
2. **Draw.** Take either the top of the **stock** or the top of the **discard**.
   Skipped on the **first turn of each round** for the player who received the bonus
   8th card during the deal — the deal counts as their draw, so they cannot steal a
   wild and must proceed directly to the meld/discard steps.
3. **Optional — Lay melds and lay-offs.**
   - Lay one or more new melds from your hand to the table (yours).
   - Extend any existing meld owned by you.
   - Extend an existing meld owned by an opponent **only if you have at least one of your own
     melds already on the table this round** (laying-off-on-opponents requirement).
   - When laying a meld containing a wild, you must declare which natural card the wild
     represents. For runs the answer is determined by suit + position; for sets you must
     declare which suit of the meld's rank the wild stands in for. The declared card cannot
     already be visibly used elsewhere in the same meld.
4. **Discard one card.** End of turn.

## Going out

- A player wins the round by reducing their hand to **zero cards** after a discard, with all
  cards either melded onto the table (in valid sets/runs) or laid off on existing melds per
  the rules above. There is no minimum knock — gin is the only way to end a round.
- Going out is legal on the very first turn ("snapper").
- The discard that finishes the round must be a real card; you cannot end a round by
  laying down a meld and then having nothing to discard.

## Melds

- **Set**: 3 or more cards of the same rank.
- **Run**: 3 or more cards of the same suit in consecutive rank order.
- **Aces** are configurable per game:
  - `low` — A-2-3 valid; Q-K-A invalid.
  - `high` (default) — Q-K-A valid; A-2-3 invalid.
  - `either` — A-2-3 and Q-K-A both valid (A may sit at either end of a run).
  - In all modes, **wraparound (K-A-2) is never legal**.

## Wild card behavior

- The wild rank for the current round may substitute for any one card in any meld.
- A meld may contain at most one wild (an additional declaration is required if more
  than one wild ever appears in the same meld; this implementation forbids it for clarity).
- When laid, the player declares the natural card the wild represents. That declaration is
  public and immutable until either:
  - The round ends, or
  - The natural card's holder steals the wild as described in "Turn structure" step 1.
- If a wild remains in any player's hand at round end (because the round ended with cards
  still in their hand), it scores **25 points** for that player.

## Stock exhaustion

- If the stock empties mid-round, take all but the current top discard, shuffle them, and
  place them face-down as the new stock. The discard pile resets to just the top card.
  This event is logged but the new stock's contents are not revealed.

## Scoring

At the end of each round, every player who did not go out scores the value of the cards
remaining in their hand:

- **A** = 1 (if `acesMode = 'low'`) or 13 (if `acesMode = 'high'` or `'either'`).
- **2–10** = face value.
- **J, Q, K** = 10.
- **Wild** (still in hand) = 25.

The player who went out scores **0** for that round.

After 13 rounds, the player with the **lowest cumulative score wins**.

### Tiebreakers

1. Fewest rounds with a non-zero score.
2. If still tied, the players share the win.

## Turn timer

- Each game has a per-turn timer (default **24 hours**, configurable from 1 minute upward).
- When a turn timer expires, the server performs an **auto-play**:
  - On a normal turn: draw the top of the stock and discard that same card.
  - On the **first turn of a round** (the bonus-card holder has not yet acted): discard
    the bonus 8th card that was dealt to them.
- No melds are laid or stolen on auto-play. The auto-play is logged.

## Discard pile visibility

- By default only the **top discard** is visible to all players (classic).
- A game may be configured to expose the **last N discards** to everyone; this is intended
  for async play where days may pass between turns.
- The full pile is never visible unless `discardVisibility` >= 999 (treated as "all").

## Spectators

- Anyone with the invite link may join as a spectator if `spectatorsAllowed = true`.
- Spectators see the same view a player would see — **table state, scores, top discard(s),
  and turn timer — but no hands**.

## Configuration summary (defaults)

| Option                 | Default | Notes                                               |
|------------------------|---------|-----------------------------------------------------|
| `maxPlayers`           | 4       | 2–6                                                  |
| `turnTimerMs`          | 86_400_000 | 24h                                              |
| `discardVisibility`    | 1       | top only                                             |
| `acesMode`             | `high`  | `low` / `high` / `either`                            |
| `layoffsOnOpponents`   | `true`  | requires at least one of your own melds on the table |
| `spectatorsAllowed`    | `true`  |                                                      |
