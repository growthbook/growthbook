import { isEqual } from "lodash";
import { Revision } from "shared/enterprise";
import {
  updateConfigValidator,
  validateResolvableValue,
} from "shared/validators";
import { ConfigInterface } from "shared/types/config";
import { stripConfigExtends } from "shared/util";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import {
  buildPatchOps,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
import {
  reconcileConfigDescendants,
  assertConfigDescendantsReconcilable,
} from "back-end/src/services/configReconcile";
import { assertConfigValueValid } from "back-end/src/services/configValidation";
import { dispatchConfigRevisionEvent } from "back-end/src/services/configRevisionEvents";
import { resolveConfigSchemaSource } from "./validations";

export const updateConfig = createApiRequestHandler(updateConfigValidator)(
  async (req) => {
    const { key } = req.params;
    const { name, description, project, owner, schema, extensible } = req.body;
    const extendsKeys = req.body.extends;
    const bypassApproval = req.body.bypassApproval === true;
    // Value arrives as a native JSON object; stored/validated as a JSON string.
    // (Configs are environment-agnostic — no per-environment overrides.)
    const value =
      req.body.value !== undefined ? JSON.stringify(req.body.value) : undefined;

    // Convert the schema envelope (JSON Schema / TypeScript) to the internal
    // SimpleSchema; `warnings` surface any lossy degradation back to the caller.
    const { schema: resolvedSchema, warnings } = resolveConfigSchemaSource({
      source: schema,
    });

    const config = await req.context.models.configs.getByKey(key);
    if (!config) {
      throw new NotFoundError(`Unable to locate the config: ${key}`);
    }

    if (
      !req.context.permissions.canUpdateConfig(config, {
        project: project ?? config.project,
      })
    ) {
      req.context.permissions.throwPermissionError();
    }

    // Inheritance lives on `parent` (spine) + `extends` (mixins); strip any
    // stray `$extends` from the value (a `@config:` there is rejected upstream).
    const normalizedValue =
      value !== undefined ? stripConfigExtends(value) : undefined;
    const incomingParent = req.body.parent;

    const fieldsToUpdate: Partial<
      Omit<
        ConfigInterface,
        "id" | "organization" | "dateCreated" | "dateUpdated"
      >
    > = {};

    if (name !== undefined && name !== config.name) {
      fieldsToUpdate.name = name;
    }
    if (owner !== undefined && owner !== config.owner) {
      fieldsToUpdate.owner = owner;
    }
    if (description !== undefined && description !== config.description) {
      fieldsToUpdate.description = description;
    }
    if (project !== undefined && project !== config.project) {
      if (project) {
        await req.context.models.projects.ensureProjectsExist([project]);
      }
      fieldsToUpdate.project = project;
    }
    const parentChanged =
      incomingParent !== undefined &&
      (incomingParent || "") !== (config.parent || "");
    if (parentChanged) {
      fieldsToUpdate.parent = incomingParent || undefined;
    }
    const extendsChanged =
      extendsKeys !== undefined && !isEqual(extendsKeys, config.extends ?? []);
    if (extendsChanged) {
      // Store the array as-is (including `[]` to clear all mixins). `undefined`
      // is dropped by the update/patch layer and would silently no-op the clear.
      fieldsToUpdate.extends = extendsKeys;
    }
    if (value !== undefined) {
      // Lineage is set via `parent`/`extends`; a `@config:` ref in the value is
      // rejected.
      validateResolvableValue({
        type: "json",
        value,
        label: "value",
        refSource: "config",
      });
      if (normalizedValue !== config.value) {
        fieldsToUpdate.value = normalizedValue;
      }
    }
    if (
      resolvedSchema !== undefined &&
      !isEqual(resolvedSchema, config.schema)
    ) {
      fieldsToUpdate.schema = resolvedSchema;
    }
    if (extensible !== undefined && extensible !== config.extensible) {
      fieldsToUpdate.extensible = extensible;
    }

    // Enforce "base wins" up front (the publish path re-runs it too). A parent
    // move or a mixin change shifts which fields the bases own, so re-normalize
    // the config's own schema even when the caller didn't send one.
    const effectiveParent = parentChanged ? incomingParent : config.parent;
    const effectiveExtends = extendsChanged
      ? (fieldsToUpdate.extends as string[] | undefined)
      : config.extends;
    const schemaToNormalize = fieldsToUpdate.schema ?? config.schema;
    if (
      (fieldsToUpdate.schema || parentChanged || extendsChanged) &&
      schemaToNormalize
    ) {
      const normalized =
        await req.context.models.configs.normalizeSchemaAgainstAncestors(
          {
            key: config.key,
            parent: effectiveParent || undefined,
            extends: effectiveExtends,
            value: fieldsToUpdate.value ?? config.value,
          },
          schemaToNormalize,
        );
      // Compare against the schema we were about to persist (the sent schema or
      // the existing one), not `config.schema`: if normalization changed it
      // (e.g. stripped ancestor-owned fields), persist the normalized form.
      if (!isEqual(normalized, schemaToNormalize)) {
        fieldsToUpdate.schema = normalized;
      }
    }

    // Cycle rejection is enforced in ConfigModel (covers every write path).

    if (Object.keys(fieldsToUpdate).length === 0) {
      return {
        config: await resolveOwnerEmail(
          req.context.models.configs.toApiInterface(config),
          req.context,
        ),
        ...(warnings.length ? { warnings } : {}),
      };
    }

    // Re-validate the post-update value against the post-update effective
    // schema whenever anything that affects conformance changed. Opt out with
    // ?skipSchemaValidation=true.
    if (
      fieldsToUpdate.value !== undefined ||
      fieldsToUpdate.schema !== undefined ||
      fieldsToUpdate.extensible !== undefined ||
      parentChanged ||
      extendsChanged
    ) {
      const postValue = fieldsToUpdate.value ?? config.value;
      await assertConfigValueValid(
        req.context,
        {
          key: config.key,
          name: config.name,
          value: postValue,
          schema: fieldsToUpdate.schema ?? config.schema,
          parent: effectiveParent || undefined,
          extends: effectiveExtends,
          extensible: fieldsToUpdate.extensible ?? config.extensible,
        },
        { value: postValue },
      );
    }

    // A schema change, a parent move, or a mixin change all shift the subtree's
    // effective ancestry, so descendants must be re-reconciled.
    const needsDescendantReconcile =
      fieldsToUpdate.schema !== undefined || parentChanged || extendsChanged;

    // Dry run BEFORE any write: reject a publish that would create an
    // unresolvable sibling conflict at a descendant, so nothing is persisted
    // (vs. committing the root and then throwing from the post-write cascade).
    // See assertConfigDescendantsReconcilable for the accepted residual race.
    if (needsDescendantReconcile) {
      await assertConfigDescendantsReconcilable(req.context, {
        ...config,
        ...fieldsToUpdate,
      } as ConfigInterface);
    }

    // Change-aware approval gate (a value/schema change always requires review
    // when the project has requireReviews; metadata-only may be exempt) —
    // mirrors the internal PUT controller.
    const adapter = getAdapter("config");
    const patchOps = buildPatchOps(fieldsToUpdate as Record<string, unknown>);
    const approvalRequired = adapter.isApprovalRequiredForRevision
      ? adapter.isApprovalRequiredForRevision(req.context, {
          target: { snapshot: config, proposedChanges: patchOps },
        } as unknown as Revision)
      : adapter.isApprovalRequired(req.context);

    if (approvalRequired) {
      if (!bypassApproval) {
        throw new BadRequestError(
          "This organization requires approvals for this config. " +
            `Use \`POST /configs-revisions/${config.key}\` to open a draft, ` +
            'or pass `{ "bypassApproval": true }` if you have the bypass permission.',
        );
      }
      const canBypass =
        !!req.organization.settings?.restApiBypassesReviews ||
        adapter.canBypassApproval(
          req.context,
          config as unknown as Record<string, unknown>,
        );
      if (!canBypass) {
        req.context.permissions.throwPermissionError();
      }

      // Record the already-merged revision FIRST, then apply it to the live
      // entity, rolling the revision back if the apply fails.
      await ensureLiveRevisionExists(
        req.context,
        "config",
        config as unknown as Record<string, unknown> & {
          id: string;
          owner?: string;
          dateCreated?: Date;
        },
      );
      const merged = await req.context.models.revisions.createMerged({
        type: "config",
        id: config.id,
        snapshot: config as unknown as Record<string, unknown>,
        proposedChanges: patchOps,
        bypass: true,
      });
      let updated: Partial<ConfigInterface>;
      try {
        updated = await req.context.models.configs.update(
          config,
          fieldsToUpdate as Parameters<
            typeof req.context.models.configs.update
          >[1],
        );
      } catch (e) {
        try {
          await req.context.models.revisions.deleteById(merged.id);
        } catch {
          // ignore — surface the original update error
        }
        throw e;
      }
      // A schema/parent change can introduce a field a descendant already
      // declares; cascade "base wins" down the subtree.
      if (needsDescendantReconcile) {
        await reconcileConfigDescendants(req.context, config.key);
      }
      await dispatchConfigRevisionEvent(req.context, merged, {
        type: "published",
      });
      return {
        config: await resolveOwnerEmail(
          req.context.models.configs.toApiInterface({ ...config, ...updated }),
          req.context,
        ),
        ...(warnings.length ? { warnings } : {}),
      };
    }

    const updated = await req.context.models.configs.update(
      config,
      fieldsToUpdate as Parameters<typeof req.context.models.configs.update>[1],
    );
    if (needsDescendantReconcile) {
      await reconcileConfigDescendants(req.context, config.key);
    }
    return {
      config: await resolveOwnerEmail(
        req.context.models.configs.toApiInterface({ ...config, ...updated }),
        req.context,
      ),
      ...(warnings.length ? { warnings } : {}),
    };
  },
);
