import { Revision } from "shared/enterprise";
import {
  postConfigValidator,
  validateResolvableValue,
} from "shared/validators";
import { ConfigInterface } from "shared/types/config";
import { stripConfigExtends } from "shared/util";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  BadRequestError,
  PlanDoesNotAllowError,
} from "back-end/src/util/errors";
import { assertKeyAvailable } from "back-end/src/services/constants";
import { assertConfigValueValid } from "back-end/src/services/configValidation";
import { getAdapter } from "back-end/src/revisions";
import {
  buildPatchOps,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";

export const postConfig = createApiRequestHandler(postConfigValidator)(async (
  req,
) => {
  const {
    key,
    name,
    value,
    environmentValues,
    description,
    project,
    owner,
    schema,
    extensible,
  } = req.body;
  const extendsKeys = req.body.extends;
  const bypassApproval = req.body.bypassApproval === true;

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

  // A child created under a base can't re-declare an inherited field ("base
  // wins"); strip any colliding keys from its appended schema up front.
  const normalizedSchema =
    await req.context.models.configs.normalizeSchemaAgainstAncestors(
      { key, parent: parent || undefined, extends: extendsKeys, value },
      schema,
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

  // Change-aware approval gate, scoped to the new config's project (a create
  // in a project without a review rule isn't gated). There's no existing
  // entity to draft against on create, so the only non-UI path under required
  // approvals is bypass.
  const adapter = getAdapter("config");
  const patchOps = buildPatchOps({
    name,
    ...(parent ? { parent } : {}),
    ...(extendsKeys ? { extends: extendsKeys } : {}),
    ...(value !== undefined ? { value: stripConfigExtends(value) } : {}),
    ...(environmentValues ? { environmentValues } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(project ? { project } : {}),
    ...(owner ? { owner } : {}),
    ...(normalizedSchema ? { schema: normalizedSchema } : {}),
    ...(extensible !== undefined ? { extensible } : {}),
  });
  const approvalRequired = adapter.isApprovalRequiredForRevision
    ? adapter.isApprovalRequiredForRevision(req.context, {
        target: {
          snapshot: { project: project || "" },
          proposedChanges: patchOps,
        },
      } as unknown as Revision)
    : adapter.isApprovalRequired(req.context);
  if (approvalRequired) {
    if (!bypassApproval) {
      throw new BadRequestError(
        "This organization requires approvals for this config's project. " +
          "Create it through the GrowthBook UI's approval flow, " +
          'or pass `{ "bypassApproval": true }` if you have the bypass permission.',
      );
    }
    const canBypass =
      !!req.organization.settings?.restApiBypassesReviews ||
      adapter.canBypassApproval(req.context, {
        project: project || "",
      } as unknown as Record<string, unknown>);
    if (!canBypass) {
      req.context.permissions.throwPermissionError();
    }
  }

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
  };
});
