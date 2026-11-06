/**
 * Prop schemas for the rules-domain components. Kept in their own folder so the generic
 * catalog can be extracted and published without the rules domain.
 * Heavy data (graph JSON, diffs, test results) is never embedded in the spec: these
 * components fetch and save through BFF actions using the props below as references.
 */
import { z } from 'zod';

const Key = z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/);
const Option = z.object({ value: z.string(), label: z.string() });

export const domainSchemas = {
  JdmEditor: {
    props: z.object({
      app: Key,
      decisionRef: Key,
      /** Version number to open; null opens the latest draft (or an empty graph). */
      versionId: z.number().int().positive().nullable(),
      readOnly: z.boolean(),
      /** Lets the user save the edited graph as a new draft (requires `edit`, enforced server-side). */
      canSave: z.boolean().default(false),
    }),
    description: 'GoRules visual decision editor (DecisionGraph inside JdmConfigProvider)',
  },
  VersionDiff: {
    props: z.object({
      app: Key,
      decision: Key,
      from: z.number().int().positive(),
      to: z.number().int().positive(),
      versions: z.array(z.number().int().positive()).default([]),
    }),
    description: 'Side-by-side JSON diff of two versions, with a structured change list',
  },
  TestPanel: {
    props: z.object({
      app: Key,
      decision: Key,
      targets: z.array(Option).min(1),
      defaultTarget: z.string(),
      sampleInput: z.record(z.string(), z.unknown()).default({}),
      canRunStoredTests: z.boolean().default(false),
    }),
    description: 'Enter input JSON, evaluate a draft or published version, see output and trace',
  },
  AuditTimeline: {
    props: z.object({
      entries: z.array(
        z.object({
          id: z.number(),
          actor: z.string(),
          action: z.string(),
          at: z.string(),
          summary: z.string(),
          decision: z.string().nullable().optional(),
          version: z.number().nullable().optional(),
        }),
      ),
    }),
    description: 'Chronological audit entries',
  },
  AiGeneratePanel: {
    props: z.object({
      app: Key,
      decision: Key,
      enabled: z.boolean(),
      disabledReason: z.string().optional(),
      providers: z.array(z.object({ id: z.number(), name: z.string(), model: z.string() })),
      baseVersions: z.array(z.number().int().positive()).default([]),
    }),
    description: 'Describe a rule in plain language (plus optional schema/examples/context) and generate a draft',
  },
  ProviderSettings: {
    props: z.object({
      app: Key,
      canEdit: z.boolean(),
      providers: z.array(
        z.object({
          id: z.number(),
          name: z.string(),
          type: z.enum(['anthropic', 'openai', 'azure_openai', 'openai_compatible', 'mock']),
          model: z.string(),
          baseUrl: z.string().nullable(),
          apiKeyRef: z.string().nullable(),
          keyConfigured: z.boolean(),
          enabled: z.boolean(),
          monthlyTokenBudget: z.number().nullable(),
          tokensThisMonth: z.number(),
        }),
      ),
      appProviderId: z.number().nullable(),
      appFallbackProviderId: z.number().nullable(),
    }),
    description: 'Admin form for LLM providers (type, model, base URL, key reference) with Test connection; never shows keys',
  },
} as const;
