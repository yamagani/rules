import { z } from 'zod';

/** A prop that may be a literal or a json-render state expression (`$state` / `$bindState`). */
export const StateRef = z.object({ $state: z.string().startsWith('/') }).strict();
export const BindStateRef = z.object({ $bindState: z.string().startsWith('/') }).strict();

export const bindable = <T extends z.ZodType>(schema: T) => z.union([schema, StateRef, BindStateRef]);
