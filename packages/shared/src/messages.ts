/**
 * WebSocket message schemas (Zod) shared between client and server.
 *
 * Server-bound (client → server): {@link ClientMsg}
 * Client-bound (server → client): {@link ServerMsg}
 */

import { z } from 'zod';

const cardSchema = z.string().regex(/^[A23456789TJQKA][SHDC]$/, 'Invalid card format');

export const ClientMsg = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), token: z.string().optional() }),
  z.object({
    type: z.literal('steal_wild'),
    meldId: z.string(),
    surrender: cardSchema,
  }),
  z.object({ type: z.literal('draw_stock') }),
  z.object({ type: z.literal('draw_discard') }),
  z.object({
    type: z.literal('lay_meld'),
    cards: z.array(cardSchema).min(3),
    wildSlot: z.number().int().nonnegative().optional(),
    wildRepresents: cardSchema.optional(),
  }),
  z.object({
    type: z.literal('extend_meld'),
    meldId: z.string(),
    cards: z.array(cardSchema).min(1),
    /** Optional: when extending with a wild, which card does it represent. */
    wildSlot: z.number().int().nonnegative().optional(),
    wildRepresents: cardSchema.optional(),
  }),
  z.object({ type: z.literal('discard'), card: cardSchema }),
  z.object({ type: z.literal('chat'), text: z.string().min(1).max(500) }),
]);

export type ClientMsg = z.infer<typeof ClientMsg>;

export const ServerMsg = z.discriminatedUnion('type', [
  z.object({ type: z.literal('state'), view: z.unknown() }),
  z.object({ type: z.literal('event'), event: z.unknown() }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
  z.object({
    type: z.literal('chat'),
    fromId: z.string(),
    fromName: z.string(),
    text: z.string(),
    at: z.number(),
  }),
  z.object({ type: z.literal('hello_ack'), youAre: z.string().nullable(), spectator: z.boolean() }),
]);

export type ServerMsg = z.infer<typeof ServerMsg>;
