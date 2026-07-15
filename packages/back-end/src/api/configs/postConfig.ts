import {
  postConfigValidator,
  validateResolvableValue,
} from "shared/validators";
import { ConfigInterface } from "shared/types/config";
import {
  stripConfigExtends,
  apiInvariantsToStored,
  formatAncestorFieldConflictMessage,
  ancestorCollisionWarnings,
  findUndeclaredInvariantRuleFields,
  undeclaredRuleFieldWarnings,
} from "shared/util";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  BadRequestError,
  PlanDoesNotAllowError,
} from "back-end/src/util/errors";
import {
  assertKeyAvailable,
  assertScopedOverridesValid,
  syncScopedConfigMarkers,
} from "back-end/src/services/constants";
import {
  assertConfigValueValid,
  assertConfigValueValidForCreate,
  getEffectiveConfigSchema,
} from "back-end/src/services/configValidation";
import { runValidateConfigHooks } from "back-end/src/enterprise/sandbox/sandbox-eval";
import { ensureLiveRevisionExists } from "back-end/src/revisions/util";
import { resolveConfigSchemaSource } from "./validations";

export const postConfig = createApiRequestHandler(postConfigValidator)(async (
  req,
) => {
  const { key, name, description, project, owner, schema, extensible } =
    req.body;
  const extendsKeys = req.body.extends;
  const scopedOverrides = req.body.scopedOverrides;
  // Value arrives as a native JSON object; stored/validated as a JSON string.
  const value =
    req.body.value !== undefined ? JSON.stringify(req.body.value) : undefined;

  if (!req.context.permissions.canCreateConfig({ project: project || "" })) {
    req.context.permissions.throwPermissionError();
  }

  // Only creation is premium-gated; update/delete are not, so a lapsed license
  // can still manage existing configs.
  if (!req.context.hasPremiumFeature("feature-configs")) {
    throw new PlanDoesNotAllowError(
      "Creating configs requires a plan that includes feature configs.",
    );
  }

  if (project) {
    await req.context.models.projects.ensureProjectsExist([project]);
  }

  // Unique within the config namespace; a constant may share the key
  // (`@config:foo` and `@const:foo` are distinct).
  await assertKeyAvailable(req.context, key, "config");

  // A `@config:` ref in the value is rejected (lineage lives on `parent`/`extends`).
  if (value !== undefined)
    validateResolvableValue({
      type: "json",
      value,
      label: "value",
      refSource: "config",
    });

  // Inheritance lives on `parent` (spine) + `extends` (mixins); never in value.
  const parent = req.body.parent || "";

  // Converting the schema envelope here keeps create single-shot from source.
  const {
    schema: resolvedSchema,
    warnings,
    projection,
  } = resolveConfigSchemaSource({
    source: schema,
  });

  // Validation rules ride alongside the schema (rule as JSONLogic or CEL).
  const storedInvariants = (() => {
    try {
      return req.body.invariants
        ? apiInvariantsToStored(req.body.invariants)
        : undefined;
    } catch (e) {
      throw new BadRequestError(e instanceof Error ? e.message : String(e));
    }
  })();
  const schemaWithInvariants = storedInvariants?.length
    ? {
        ...(resolvedSchema ?? { type: "object" as const, fields: [] }),
        invariants: storedInvariants,
      }
    : resolvedSchema;

  // "Base wins": strip inherited field keys the child re-declares identically
  // (with a warning); a re-declaration with a DIFFERING definition is rejected
  // — its intent can't be preserved by a strip.
  const {
    schema: normalizedSchema,
    identical,
    conflicting,
  } = await req.context.models.configs.normalizeSchemaAgainstAncestors(
    { key, parent: parent || undefined, extends: extendsKeys, value },
    schemaWithInvariants,
  );
  if (conflicting.length) {
    throw new BadRequestError(formatAncestorFieldConflictMessage(conflicting));
  }
  warnings.push(...ancestorCollisionWarnings(identical));

  // Warn (never block) when a rule references a field the effective schema
  // doesn't declare — it would just read null at evaluation time.
  if (normalizedSchema?.invariants?.length) {
    const { fields: effectiveFields } = await getEffectiveConfigSchema(
      req.context,
      {
        key,
        name,
        value,
        schema: normalizedSchema,
        parent: parent || undefined,
        extends: extendsKeys,
      },
    );
    warnings.push(
      ...undeclaredRuleFieldWarnings(
        findUndeclaredInvariantRuleFields(
          normalizedSchema.invariants,
          effectiveFields.map((f) => f.key),
        ),
      ),
    );
  }

  const storedValue = stripConfigExtends(value);
  const createLeaf = {
    key,
    name,
    value: storedValue,
    schema: normalizedSchema,
    parent: parent || undefined,
    extends: extendsKeys,
    extensible,
  };
  await assertConfigValueValid(req.context, createLeaf, {
    value: storedValue,
  });
  // Creation goes live immediately, so also enforce required fields +
  // cross-field invariants (the publish-time checks).
  await assertConfigValueValidForCreate(req.context, createLeaf, {
    value: storedValue,
  });

  // Cycle rejection is enforced in ConfigModel (covers every write path).

  // Customer publish-time checks: run validateConfig hooks on the new config
  // (sandboxed, self-host + enterprise; a no-op otherwise). Hard-blocks or
  // soft-warns before anything is persisted.
  await runValidateConfigHooks({
    context: req.context,
    config: {
      key,
      name,
      project: project || "",
      value: stripConfigExtends(value),
      schema: normalizedSchema,
      parent: parent || undefined,
      extends: extendsKeys,
      extensible,
    },
    original: null,
  });

  await assertScopedOverridesValid(req.context, {
    key,
    project: project || "",
    scopedOverrides,
  });

  // Creation never requires approval: a brand-new config has no dependents, so
  // it can't change any resolved value. Approvals apply to later changes.
  const config = await req.context.models.configs.create({
    key,
    name,
    owner: owner || req.context.userId || "",
    parent: parent || undefined,
    extends: extendsKeys,
    value: stripConfigExtends(value),
    scopedOverrides,
    description,
    project: project || "",
    schema: normalizedSchema,
    extensible,
    // Seed the experiment guard from the org default (concrete per-config flag);
    // an explicit body value wins.
    experimentGuard:
      req.body.experimentGuard ??
      req.context.org.settings?.configExperimentGuardDefault ??
      false,
    ...(req.body.source && projection
      ? { renderProjections: { [req.body.source]: projection } }
      : {}),
  });

  // Stamp each attached flavor's scopedConfig marker (the internal create does
  // the same) — approval scoping and the flavor filters read it.
  if (scopedOverrides?.length) {
    await syncScopedConfigMarkers(req.context, key, [], scopedOverrides);
  }

  // Backfill a live revision so the config is immediately editable via revisions.
  await ensureLiveRevisionExists(
    req.context,
    "config",
    config as unknown as Record<string, unknown> & {
      id: string;
      owner?: string;
      dateCreated?: Date;
    },
  );

  return {
    config: await resolveOwnerEmail(
      req.context.models.configs.toApiInterface(config as ConfigInterface),
      req.context,
    ),
    ...(warnings.length ? { warnings } : {}),
  };
});
