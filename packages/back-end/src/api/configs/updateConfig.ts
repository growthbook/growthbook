import { isEqual } from "lodash";
import { Revision } from "shared/enterprise";
import {
  updateConfigValidator,
  validateResolvableValue,
} from "shared/validators";
import { ConfigInterface } from "shared/types/config";
import { getConfigParentKey, stripConfigExtends } from "shared/util";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import {
  buildPatchOps,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
import { reconcileConfigDescendants } from "back-end/src/services/configReconcile";
import { dispatchConfigRevisionEvent } from "back-end/src/services/configRevisionEvents";

export const updateConfig = createApiRequestHandler(updateConfigValidator)(
  async (req) => {
    const { key } = req.params;
    const {
      name,
      value,
      environmentValues,
      description,
      project,
      owner,
      schema,
      extensible,
    } = req.body;
    const bypassApproval = req.body.bypassApproval === true;

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

    // Inheritance lives on `parent`; strip any `$extends` from the value and
    // migrate a legacy in-value `@config:` ref when the caller didn't set one.
    const normalizedValue =
      value !== undefined ? stripConfigExtends(value) : undefined;
    const incomingParent =
      req.body.parent !== undefined
        ? req.body.parent
        : value !== undefined
          ? (getConfigParentKey({ value }) ?? undefined)
          : undefined;

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
    if (value !== undefined) {
      // Validate the raw value (may carry a `@config:` parent ref first).
      validateResolvableValue({ type: "json", value, label: "value" });
      if (normalizedValue !== config.value) {
        fieldsToUpdate.value = normalizedValue;
      }
    }
    if (
      environmentValues !== undefined &&
      !isEqual(environmentValues, config.environmentValues)
    ) {
      for (const [env, v] of Object.entries(environmentValues)) {
        validateResolvableValue({ type: "json", value: v, label: env });
      }
      fieldsToUpdate.environmentValues = environmentValues;
    }
    if (schema !== undefined && !isEqual(schema, config.schema)) {
      fieldsToUpdate.schema = schema;
    }
    if (extensible !== undefined && !!extensible !== !!config.extensible) {
      fieldsToUpdate.extensible = extensible;
    }

    // Enforce "base wins" up front (the publish path re-runs it too). A parent
    // move changes which fields the ancestors own, so re-normalize the config's
    // own schema even when the caller didn't send one.
    const effectiveParent = parentChanged ? incomingParent : config.parent;
    const schemaToNormalize = fieldsToUpdate.schema ?? config.schema;
    if ((fieldsToUpdate.schema || parentChanged) && schemaToNormalize) {
      const normalized =
        await req.context.models.configs.normalizeSchemaAgainstAncestors(
          {
            key: config.key,
            parent: effectiveParent || undefined,
            value: fieldsToUpdate.value ?? config.value,
          },
          schemaToNormalize,
        );
      if (!isEqual(normalized, config.schema)) {
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
      };
    }

    // A schema change or a parent move both shift the subtree's effective
    // ancestry, so descendants must be re-reconciled in either case.
    const needsDescendantReconcile =
      fieldsToUpdate.schema !== undefined || parentChanged;

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
    };
  },
);
