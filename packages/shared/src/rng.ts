/**
 * Deterministic pseudo-random number generator (mulberry32) and a Fisher-Yates shuffle that
 * uses it. We seed each round with a server-generated 64-bit hex string so that the entire
 * round can be replayed deterministically given the seed and the action log.
 *
 * The seed is never exposed to clients — only the server (Durable Object) holds it.
 */

export type RNG = () => number;

/** Mulberry32 — small, fast, good-enough for shuffling cards. */
export function mulberry32(seed: number): RNG {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash a hex seed string to a 32-bit integer (FNV-1a). */
export function seedToInt(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Build a deterministic RNG from a hex seed string. */
export function rngFromSeed(seed: string): RNG {
  return mulberry32(seedToInt(seed));
}

/** Fisher-Yates shuffle, in place. Returns the same array for chaining. */
export function shuffle<T>(arr: T[], rng: RNG): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

/** Generate a fresh 16-character hex seed using crypto. Suitable as a per-round seed. */
export function newSeed(): string {
  const bytes = new Uint8Array(8);
  // Available in Workers, Node 22, and modern browsers.
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
