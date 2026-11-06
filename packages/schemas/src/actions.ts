/**
 * Payloads for POST /bff/<mfe>/actions/<action>. The BFF validates every request with these
 * schemas and answers 400 with field errors; the UI uses the same types.
 */
import { z } from 'zod';
import {
  AliasName,
  AppKey,
  DecisionKey,
  JdmDocument,
  JsonObject,
  Permission,
  ProviderType,
} from './domain';

const base = { app: AppKey };
const decision = { ...base, decision: DecisionKey };

/** HTML inputs bind strings; accept "3" as well as 3 for numeric fields. */
const IntLike = z.coerce.number().int().positive();

export const rulesActions = {
  createDecision: z.object({ ...base, key: DecisionKey, name: z.string().min(1).max(200), description: z.string().max(2000).optional() }),
  loadVersion: z.object({ ...decision, version: IntLike.optional(), draft: z.boolean().optional() }),
  saveVersion: z.object({ ...decision, content: JdmDocument, comment: z.string().max(2000).optional() }),
  evaluate: z.object({
    ...decision,
    context: JsonObject,
    version: IntLike.optional(),
    alias: AliasName.optional(),
    draft: z.boolean().optional(),
    trace: z.boolean().optional(),
  }),
  runTests: z.object({ ...decision, version: IntLike }),
  addTestCase: z.object({ ...decision, name: z.string().min(1).max(200), input: JsonObject, expected: JsonObject }),
  generate: z.object({
    ...decision,
    prompt: z.string().min(1, 'Describe the rule').max(4000),
    inputSchema: JsonObject.optional(),
    examples: z.array(z.object({ name: z.string().optional(), input: JsonObject, expected: JsonObject })).max(20).optional(),
    contextText: z.string().max(20000).optional(),
    baseVersion: IntLike.optional(),
    providerId: z.coerce.number().int().positive().optional(),
  }),
  explain: z.object({ ...decision, version: IntLike }),
} as const;

export const releasesActions = {
  activate: z.object({
    ...decision,
    version: IntLike,
    // Form selects bind '' for "no alias"; drop empties before validating names.
    aliases: z.preprocess((v) => (Array.isArray(v) ? v.filter((a) => a !== '' && a != null) : v), z.array(AliasName)).optional(),
    force: z.boolean().optional(),
  }),
  deprecate: z.object({ ...decision, version: IntLike, sunsetAt: z.string().datetime({ offset: true }).optional().or(z.literal('').transform(() => undefined)) }),
  disable: z.object({ ...decision, version: IntLike }),
  enable: z.object({ ...decision, version: IntLike, force: z.boolean().optional() }),
  setAlias: z.object({ ...decision, alias: AliasName, version: IntLike }),
  deleteAlias: z.object({ ...decision, alias: AliasName }),
  diff: z.object({ ...decision, from: IntLike, to: IntLike }),
} as const;

export const adminActions = {
  addGrant: z.object({
    ...base,
    subjectType: z.enum(['user', 'group']).default('user'),
    subject: z.string().min(1).max(200),
    permission: Permission,
    global: z.boolean().optional(),
  }),
  deleteGrant: z.object({ ...base, grantId: z.coerce.number().int().positive() }),
  createProvider: z.object({
    ...base,
    name: z.string().min(1).max(100),
    type: ProviderType,
    model: z.string().min(1).max(200),
    baseUrl: z.string().url().optional().or(z.literal('').transform(() => undefined)),
    apiKeyRef: z
      .string()
      .regex(/^[a-z][a-z0-9-]*:[A-Za-z0-9_./+=@-]+$/, 'a reference such as env:ANTHROPIC_API_KEY, never a key')
      .optional()
      .or(z.literal('').transform(() => undefined)),
    enabled: z.boolean().optional(),
    monthlyTokenBudget: z.coerce.number().int().nonnegative().optional(),
  }),
  updateProvider: z.object({
    ...base,
    providerId: z.coerce.number().int().positive(),
    model: z.string().min(1).max(200).optional(),
    apiKeyRef: z.string().regex(/^[a-z][a-z0-9-]*:[A-Za-z0-9_./+=@-]+$/).optional(),
    enabled: z.boolean().optional(),
    monthlyTokenBudget: z.coerce.number().int().nonnegative().nullable().optional(),
  }),
  testProvider: z.object({ ...base, providerId: z.coerce.number().int().positive() }),
  setAppAi: z.object({
    ...base,
    providerId: z.coerce.number().int().positive().optional(),
    fallbackProviderId: z.coerce.number().int().positive().optional(),
  }),
  disableAppAi: z.object(base),
} as const;

export const actionSchemas = { rules: rulesActions, releases: releasesActions, admin: adminActions } as const;
export type MfeName = keyof typeof actionSchemas;
export type ActionName<M extends MfeName> = keyof (typeof actionSchemas)[M] & string;
export type ActionPayload<M extends MfeName, A extends ActionName<M>> = z.infer<(typeof actionSchemas)[M][A]>;

/** Standard response envelope for BFF actions. */
export const ActionResult = z.object({
  ok: z.literal(true),
  message: z.string().optional(),
  data: z.unknown().optional(),
  /** Hint for the runtime: refetch the current screen after this action. */
  refresh: z.boolean().optional(),
  navigate: z.string().optional(),
});
export type ActionResult = z.infer<typeof ActionResult>;

/** Convert Zod issues to `{ "field.path": ["message"] }`. */
export function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}
