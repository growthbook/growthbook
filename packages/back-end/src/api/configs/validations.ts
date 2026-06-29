import {
  validateResolvableValue,
  simpleSchemaValidator,
  configSchemaFormatValidator,
  ConfigSchemaSource,
} from "shared/validators";
import type { ConfigInterface } from "shared/types/config";
import type { SimpleSchema } from "shared/types/feature";
import { z } from "zod";
import {
  Revision,
  RevisionStatus,
  normalizeProposedChanges,
} from "shared/enterprise";
import {
  parsePlainJSONObject,
  inferFieldsFromValue,
  jsonSchemaStringToFields,
  tsTypesToFields,
  SchemaWarning,
} from "shared/util";
import { ApiReqContext } from "back-end/types/api";
import {
  applyPatchToSnapshot,
  createOrUpdateRevision,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";

// Open (editable, non-terminal) statuses — mirrors the constant helper.
export const ACTIVE_STATUSES: readonly RevisionStatus[] = [
  "draft",
  "pending-review",
  "approved",
  "changes-requested",
];

export function isDraftStatus(status: string): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(status);
}

// The loosely-typed entity shape the revision helpers expect.
export type RevisionEntityArg = Record<string, unknown> & {
  id: string;
  owner?: string;
  dateCreated?: Date;
};

async function createBlankDraft(
  context: ApiReqContext,
  config: ConfigInterface,
  options: { title?: string; comment?: string } = {},
): Promise<Revision> {
  await ensureLiveRevisionExists(
    context,
    "config",
    config as unknown as RevisionEntityArg,
  );
  return createOrUpdateRevision(
    context,
    "config",
    config as unknown as Record<string, unknown> & { id: string },
    [],
    { forceCreate: true, title: options.title, comment: options.comment },
  );
}

// Look up a revision by version, scoped to the supplied config.
export async function loadRevisionByVersion(
  context: ApiReqContext,
  configId: string,
  version: number,
): Promise<Revision> {
  const revision = await context.models.revisions.getByTargetAndVersion(
    "config",
    configId,
    version,
  );
  if (
    !revision ||
    revision.target.type !== "config" ||
    revision.target.id !== configId
  ) {
    throw new NotFoundError("Could not find config revision");
  }
  return revision;
}

// Resolve a pinned version, or auto-create a fresh draft when version === "new".
export async function resolveOrCreateRevision(
  context: ApiReqContext,
  config: ConfigInterface,
  version: number | "new",
  options: { title?: string; comment?: string } = {},
): Promise<{ revision: Revision; created: boolean }> {
  if (version === "new") {
    const revision = await createBlankDraft(context, config, options);
    return { revision, created: true };
  }
  const revision = await loadRevisionByVersion(context, config.id, version);
  return { revision, created: false };
}

// Best-effort discard of a just-created draft. Never throws.
export async function discardIfJustCreated(
  context: ApiReqContext,
  revision: Revision,
  created: boolean,
): Promise<void> {
  if (!created) return;
  try {
    await context.models.revisions.close(
      revision.id,
      context.userId,
      "Discarded after error during draft initialization",
    );
  } catch (err) {
    logger.warn(
      { err, revisionId: revision.id, configId: revision.target.id },
      "Failed to discard orphaned config draft after downstream failure",
    );
  }
}

// The config as it stands on a revision (base snapshot + staged changes).
export function applyRevisionToSnapshot(revision: Revision): ConfigInterface {
  return applyPatchToSnapshot(
    revision.target.snapshot as ConfigInterface,
    normalizeProposedChanges(revision.target.proposedChanges),
  ) as ConfigInterface;
}

// `mine=true` requires a user-scoped key so the caller is identifiable.
export function assertUserScopedKeyForMine(
  context: ApiReqContext,
  mine: boolean,
): void {
  if (mine && !context.userId) {
    throw new BadRequestError(
      "`mine=true` requires a user-scoped API key (the caller must be identifiable as a user).",
    );
  }
}

// Translate the public `status` query param into the model's filter shape.
export function buildRevisionStatusFilter(
  input?: string,
): string | string[] | undefined {
  if (!input) return undefined;
  const parts = input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.includes("open")) return "open";
  return parts.length === 1 ? parts[0] : parts;
}

export function pickNewDraftMetadata(body: {
  revisionTitle?: string;
  revisionComment?: string;
}): { title?: string; comment?: string } {
  return { title: body.revisionTitle, comment: body.revisionComment };
}

// Validate a staged value/environmentValues edit. Configs are always JSON
// objects (empty allowed). `@const:` refs are allowed; lineage is expressed via
// `parent`/`extends`, so a `@config:` ref in the value is rejected here.
export function assertValidConfigValueEdit(
  value: string | undefined,
  environmentValues: Record<string, string> | undefined,
): void {
  try {
    if (value !== undefined)
      validateResolvableValue({
        type: "json",
        value,
        label: "value",
        refSource: "config",
      });
    for (const [env, v] of Object.entries(environmentValues ?? {})) {
      validateResolvableValue({
        type: "json",
        value: v,
        label: env,
        refSource: "config",
      });
    }
  } catch (e) {
    throw new BadRequestError(e instanceof Error ? e.message : String(e));
  }
}

type SchemaFormat = z.infer<typeof configSchemaFormatValidator>;

// Resolve a public schema envelope (`{ type: "json-schema" | "typescript", value }`)
// or an `infer` request into a `SimpleSchema` + warnings, by translating the
// envelope to the converter's `format`+`source` form. Returns `schema: undefined`
// when neither is supplied (a schema-less create or a no-schema-change update).
export function resolveConfigSchemaSource(args: {
  source?: ConfigSchemaSource;
  infer?: boolean;
  additionalProperties?: boolean;
  inferValue?: string;
}): { schema: SimpleSchema | undefined; warnings: SchemaWarning[] } {
  const { source, infer, additionalProperties, inferValue } = args;
  if (source === undefined && infer !== true) {
    return { schema: undefined, warnings: [] };
  }
  if (source !== undefined) {
    const importArgs =
      source.type === "typescript"
        ? { format: "typescript" as const, source: source.value }
        : {
            format: "json-schema" as const,
            source: JSON.stringify(source.value),
          };
    return resolveImportedSchema({ ...importArgs, additionalProperties });
  }
  return resolveImportedSchema({
    infer: true,
    additionalProperties,
    inferValue,
  });
}

// Resolve a schema-import request body into a `SimpleSchema` plus structured
// warnings. Exactly one source must be supplied:
//   - `schema`     — a SimpleSchema object directly
//   - `format`+`source` — a raw document to convert (JSON Schema / TypeScript /
//                    a JSON-encoded SimpleSchema for `simple`)
//   - `infer`      — derive from `inferValue` (the draft's value)
// JSON Schema is the canonical pivot; conversions are lossy-by-design and never
// throw — exotic constructs degrade to permissive types WITH warnings.
export function resolveImportedSchema(args: {
  schema?: SimpleSchema;
  format?: SchemaFormat;
  source?: string;
  infer?: boolean;
  additionalProperties?: boolean;
  inferValue?: string;
}): { schema: SimpleSchema; warnings: SchemaWarning[] } {
  const { schema, format, source, infer, additionalProperties } = args;

  const sourcesProvided = [
    schema !== undefined,
    format !== undefined || source !== undefined,
    infer === true,
  ].filter(Boolean).length;
  if (sourcesProvided !== 1) {
    throw new BadRequestError(
      "Provide exactly one schema source: `schema`, `format`+`source`, or `infer: true`.",
    );
  }

  // Direct SimpleSchema.
  if (schema !== undefined) {
    return {
      schema:
        additionalProperties === undefined
          ? schema
          : { ...schema, additionalProperties },
      warnings: [],
    };
  }

  // Infer from the draft value.
  if (infer === true) {
    const obj = parsePlainJSONObject(args.inferValue ?? "") ?? {};
    const fields = inferFieldsFromValue(obj);
    return {
      schema: {
        type: "object",
        fields,
        ...(additionalProperties !== undefined ? { additionalProperties } : {}),
      },
      warnings: [],
    };
  }

  // Convert a raw document.
  if (format === undefined || source === undefined) {
    throw new BadRequestError(
      "Both `format` and `source` are required when importing from a raw document.",
    );
  }

  if (format === "simple") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch (e) {
      throw new BadRequestError(
        `Invalid SimpleSchema JSON — ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    const result = simpleSchemaValidator.safeParse(parsed);
    if (!result.success) {
      throw new BadRequestError(
        `Invalid SimpleSchema — ${result.error.message}`,
      );
    }
    return {
      schema:
        additionalProperties === undefined
          ? result.data
          : { ...result.data, additionalProperties },
      warnings: [],
    };
  }

  const converted =
    format === "json-schema"
      ? jsonSchemaStringToFields(source)
      : tsTypesToFields(source);
  if (converted.error) {
    throw new BadRequestError(
      `Could not parse ${format} schema: ${converted.error}`,
    );
  }
  return {
    schema: {
      type: "object",
      fields: converted.fields,
      ...(additionalProperties !== undefined ? { additionalProperties } : {}),
    },
    warnings: converted.warnings,
  };
}
