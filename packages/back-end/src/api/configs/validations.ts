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
  protoToFields,
  golangToFields,
  rustToFields,
  pythonToFields,
  SchemaWarning,
  SchemaProjection,
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

// `@const:` refs are allowed; a `@config:` ref is rejected (lineage lives on `parent`/`extends`).
export function assertValidConfigValueEdit(value: string | undefined): void {
  try {
    if (value !== undefined)
      validateResolvableValue({
        type: "json",
        value,
        label: "value",
        refSource: "config",
      });
  } catch (e) {
    throw new BadRequestError(e instanceof Error ? e.message : String(e));
  }
}

type SchemaFormat = z.infer<typeof configSchemaFormatValidator>;

// Returns `schema: undefined` when neither a source nor `infer` is supplied
// (a schema-less create or a no-schema-change update).
export function resolveConfigSchemaSource(args: {
  source?: ConfigSchemaSource;
  infer?: boolean;
  additionalProperties?: boolean;
  inferValue?: string;
}): {
  schema: SimpleSchema | undefined;
  warnings: SchemaWarning[];
  projection?: SchemaProjection;
} {
  const { source, infer, additionalProperties, inferValue } = args;
  if (source === undefined && infer !== true) {
    return { schema: undefined, warnings: [] };
  }
  if (source !== undefined) {
    // json-schema carries a JSON object (stringify it); other formats are source text.
    const importArgs =
      source.type === "json-schema"
        ? {
            format: "json-schema" as const,
            source: JSON.stringify(source.value),
          }
        : { format: source.type, source: source.value };
    return resolveImportedSchema({ ...importArgs, additionalProperties });
  }
  return resolveImportedSchema({
    infer: true,
    additionalProperties,
    inferValue,
  });
}

// Exactly one source must be supplied (`schema`, `format`+`source`, or `infer`).
// Conversions are lossy-by-design and never throw — exotic constructs degrade to
// permissive types WITH warnings.
export function resolveImportedSchema(args: {
  schema?: SimpleSchema;
  format?: SchemaFormat;
  source?: string;
  infer?: boolean;
  additionalProperties?: boolean;
  inferValue?: string;
}): {
  schema: SimpleSchema;
  warnings: SchemaWarning[];
  projection?: SchemaProjection;
} {
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

  if (schema !== undefined) {
    return {
      schema:
        additionalProperties === undefined
          ? schema
          : { ...schema, additionalProperties },
      warnings: [],
    };
  }

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
      : format === "protobuf"
        ? protoToFields(source)
        : format === "python"
          ? pythonToFields(source)
          : format === "go"
            ? golangToFields(source)
            : format === "rust"
              ? rustToFields(source)
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
    ...(converted.projection ? { projection: converted.projection } : {}),
  };
}
