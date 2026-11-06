import { z } from 'zod';

export const VersionStatus = z.enum(['draft', 'active', 'deprecated', 'disabled']);
export type VersionStatus = z.infer<typeof VersionStatus>;

export const Permission = z.enum(['view', 'edit', 'publish', 'evaluate', 'admin']);
export type Permission = z.infer<typeof Permission>;

export const ProviderType = z.enum(['anthropic', 'openai', 'azure_openai', 'openai_compatible', 'mock']);
export type ProviderType = z.infer<typeof ProviderType>;

export const AppKey = z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/, 'lowercase letters, digits and dashes');
export const DecisionKey = AppKey;
export const AliasName = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/, 'lowercase letters, digits and dashes');
export const VersionNumber = z.number().int().positive();

/** A JDM graph as stored by rules-service. Validated structurally there and by ZEN. */
export const JdmDocument = z
  .object({ nodes: z.array(z.record(z.string(), z.unknown())), edges: z.array(z.record(z.string(), z.unknown())) })
  .passthrough();
export type JdmDocument = z.infer<typeof JdmDocument>;

export const JsonObject = z.record(z.string(), z.unknown());

export const VersionSummary = z.object({
  id: z.number(),
  version: z.number(),
  status: VersionStatus,
  author: z.string(),
  requested_by: z.string().nullable().optional(),
  comment: z.string().nullable().optional(),
  checksum: z.string(),
  sunset_at: z.string().nullable().optional(),
  created_at: z.string(),
  activated_at: z.string().nullable().optional(),
  disabled_at: z.string().nullable().optional(),
  aliases: z.array(z.string()),
});
export type VersionSummary = z.infer<typeof VersionSummary>;

export const AliasOut = z.object({ alias: z.string(), version: z.number(), updated_by: z.string(), updated_at: z.string() });

export const TestResult = z.object({
  name: z.string(),
  passed: z.boolean(),
  expected: JsonObject,
  actual: z.unknown().optional(),
  error: z.string().nullable().optional(),
  mismatches: z.array(z.string()).default([]),
});
export const TestReport = z.object({
  version: z.number().nullable().optional(),
  total: z.number(),
  passed: z.number(),
  failed: z.number(),
  results: z.array(TestResult),
});
export type TestReport = z.infer<typeof TestReport>;

export const EvaluateResult = z.object({
  result: z.unknown(),
  meta: z.object({
    app: z.string(),
    decision: z.string(),
    version: z.number(),
    status: VersionStatus,
    resolved_by: z.enum(['version', 'alias', 'default', 'draft']),
    alias: z.string().nullable().optional(),
    deprecated: z.boolean(),
    sunset_at: z.string().nullable().optional(),
    performance: z.string().nullable().optional(),
  }),
  trace: JsonObject.nullable().optional(),
});
export type EvaluateResult = z.infer<typeof EvaluateResult>;

export const DiffChange = z.object({
  path: z.string(),
  kind: z.enum(['added', 'removed', 'changed']),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
});
export const DiffResult = z.object({
  from_version: z.number(),
  to_version: z.number(),
  changes: z.array(DiffChange),
  summary: z.record(z.string(), z.number()),
  from_content: JsonObject,
  to_content: JsonObject,
});
export type DiffResult = z.infer<typeof DiffResult>;

export const ExampleResult = TestResult.extend({ source: z.string() });
export const ValidationReport = z.object({
  ok: z.boolean(),
  attempts: z.array(
    z.object({
      attempt: z.number(),
      provider: z.string(),
      model: z.string(),
      ok: z.boolean(),
      stage: z.string(),
      errors: z.array(z.string()),
    }),
  ),
  examples: z.array(ExampleResult).default([]),
  passed: z.number().default(0),
  failed: z.number().default(0),
});
export type ValidationReport = z.infer<typeof ValidationReport>;

export const GenerateResult = z.object({
  run_id: z.number(),
  version: z.number(),
  status: z.string(),
  summary: z.string(),
  explanation: z.string(),
  provider: z.string(),
  model: z.string(),
  validation_report: ValidationReport,
  usage: z.record(z.string(), z.number()),
});
export type GenerateResult = z.infer<typeof GenerateResult>;

/** Error body returned by the BFF (and passed through from rules-service problem+json). */
export const ProblemDetails = z
  .object({
    type: z.string().optional(),
    title: z.string(),
    status: z.number(),
    detail: z.string().optional(),
    fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
    requestId: z.string().optional(),
  })
  .passthrough();
export type ProblemDetails = z.infer<typeof ProblemDetails>;
