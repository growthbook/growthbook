import {
  postConfigValidator,
  validateResolvableValue,
} from "shared/validators";
import { ConfigInterface } from "shared/types/config";
import { stripConfigExtends } from "shared/util";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { PlanDoesNotAllowError } from "back-end/src/util/errors";
import { assertKeyAvailable } from "back-end/src/services/constants";
import { assertConfigValueValid } from "back-end/src/services/configValidation";
import { ensureLiveRevisionExists } from "back-end/src/revisions/util";
import { resolveConfigSchemaSource } from "./validations";

export const postConfig = createApiRequestHandler(postConfigValidator)(async (
  req,
) => {
  const { key, name, description, project, owner, schema, extensible } =
    req.body;
  const extendsKeys = req.body.extends;
  // Values arrive as native JSON objects; stored/validated as JSON strings.
  const value =
    req.body.value !== undefined ? JSON.stringify(req.body.value) : undefined;
  const environmentValues =
    req.body.environmentValues !== undefined
      ? Object.fromEntries(
          Object.entries(req.body.environmentValues).map(([env, v]) => [
            env,
            JSON.stringify(v),
          ]),
        )
      : undefined;

  if (!req.context.permissions.canCreateConfig({ project: project || "" })) {
    req.context.permissions.throwPermissionError();
  }

  // Configs are a premium feature. Creation is gated; updating/deleting existing
  // configs is intentionally NOT, so a lapsed license can still manage what it
  // already has (it just can't create new ones).
  if (!req.context.hasPremiumFeature("feature-configs")) {
    throw new PlanDoesNotAllowError(
      "Creating configs requires a plan that includes feature configs.",
    );
  }

  if (project) {
    await req.context.models.projects.ensureProjectsExist([project]);
  }

  // Config keys are unique within the config namespace (a constant may share the
  // key — `@config:foo` and `@const:foo` are distinct).
  await assertKeyAvailable(req.context, key, "config");

  // Configs are always JSON objects (empty allowed). Lineage is expressed via
  // `parent`/`extends`, so a `@config:` ref in the value is rejected.
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

  // Inheritance lives on `parent` (spine) + `extends` (mixins); never in value.
  const parent = req.body.parent || "";

  // Convert the schema envelope (JSON Schema / TypeScript) to the internal
  // SimpleSchema in one call — this is what makes create single-shot from source.
  const { schema: resolvedSchema, warnings } = resolveConfigSchemaSource({
    source: schema,
  });

  // A child created under a base can't re-declare an inherited field ("base
  // wins"); strip any colliding keys from its appended schema up front.
  const normalizedSchema =
    await req.context.models.configs.normalizeSchemaAgainstAncestors(
      { key, parent: parent || undefined, extends: extendsKeys, value },
      resolvedSchema,
    );

  // Enforce the value against the (effective) schema. Opt out with
  // ?skipSchemaValidation=true.
  const storedValue = stripConfigExtends(value);
  await assertConfigValueValid(
    req.context,
    {
      key,
      name,
      value: storedValue,
      schema: normalizedSchema,
      parent: parent || undefined,
      extends: extendsKeys,
      extensible,
    },
    { value: storedValue, environmentValues },
  );

  // Cycle rejection is enforced in ConfigModel (covers every write path).

  // Creation never requires approval (consistent with features): a brand-new
  // config has no dependents, so creating it can't change any resolved value.
  // Approvals apply to subsequent changes via the revision flow.

  // Permission is enforced again by the model's canCreate.
  const config = await req.context.models.configs.create({
    key,
    name,
    owner: owner || req.context.userId || "",
    parent: parent || undefined,
    extends: extendsKeys,
    value: stripConfigExtends(value),
    environmentValues,
    description,
    project: project || "",
    schema: normalizedSchema,
    extensible,
  });

  // Backfill a live (published) revision so the config is immediately editable
  // through the revision system (mirrors the internal controller).
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
