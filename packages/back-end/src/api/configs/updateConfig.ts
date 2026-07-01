import { isEqual } from "lodash";
import { Revision } from "shared/enterprise";
import {
  updateConfigValidator,
  validateResolvableValue,
} from "shared/validators";
import { ConfigInterface } from "shared/types/config";
import { stripConfigExtends, apiInvariantsToStored } from "shared/util";
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
    const value =
      req.body.value !== undefined ? JSON.stringify(req.body.value) : undefined;

    // `warnings` surface any lossy degradation from the schema conversion.
    const {
      schema: resolvedSchema,
      warnings,
      projection,
    } = resolveConfigSchemaSource({
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

    // Strip any stray `$extends` from the value; lineage lives on `parent`/`extends`.
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
      // Persist a clear as "" not undefined: undefined is dropped by the patch
      // layer and would silently no-op the detach.
      fieldsToUpdate.parent = incomingParent || "";
    }
    const extendsChanged =
      extendsKeys !== undefined && !isEqual(extendsKeys, config.extends ?? []);
    if (extendsChanged) {
      // Store as-is (incl. `[]` to clear); `undefined` would be dropped and no-op the clear.
      fieldsToUpdate.extends = extendsKeys;
    }
    if (value !== undefined) {
      // A `@config:` ref in the value is rejected; lineage lives on `parent`/`extends`.
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
    // Fold validation rules into the schema to persist:
    //  - `invariants` sent → they replace (an empty array clears them);
    //  - schema sent without `invariants` → keep the config's existing rules
    //    (the JSON Schema source can't carry them, so don't drop them);
    //  - neither → no schema change from this.
    const storedInvariants = (() => {
      try {
        return req.body.invariants
          ? apiInvariantsToStored(req.body.invariants)
          : undefined;
      } catch (e) {
        throw new BadRequestError(e instanceof Error ? e.message : String(e));
      }
    })();
    let nextSchema = resolvedSchema;
    if (storedInvariants !== undefined) {
      const base = resolvedSchema ??
        config.schema ?? { type: "object" as const, fields: [] };
      if (storedInvariants.length) {
        nextSchema = { ...base, invariants: storedInvariants };
      } else {
        const { invariants: _drop, ...rest } = base;
        nextSchema = rest;
      }
    } else if (
      resolvedSchema !== undefined &&
      config.schema?.invariants?.length
    ) {
      nextSchema = { ...resolvedSchema, invariants: config.schema.invariants };
    }
    if (nextSchema !== undefined && !isEqual(nextSchema, config.schema)) {
      fieldsToUpdate.schema = nextSchema;
    }
    if (extensible !== undefined && extensible !== config.extensible) {
      fieldsToUpdate.extensible = extensible;
    }
    if (req.body.source && projection) {
      fieldsToUpdate.renderProjections = {
        ...config.renderProjections,
        [req.body.source]: projection,
      };
    }

    // "Base wins": a parent/mixin change shifts which fields the bases own, so
    // re-normalize the config's own schema even when the caller didn't send one.
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
      // Compare against the schema about to be persisted, not `config.schema`,
      // so a normalization change (e.g. stripped ancestor fields) is persisted.
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

    // Re-validate the value against the effective schema if anything affecting
    // conformance changed.
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

    // A schema/parent/mixin change shifts the subtree's ancestry, so descendants
    // must be re-reconciled.
    const needsDescendantReconcile =
      fieldsToUpdate.schema !== undefined || parentChanged || extendsChanged;

    // Dry run BEFORE any write so an unresolvable descendant conflict rejects
    // without committing the root. See assertConfigDescendantsReconcilable for
    // the accepted residual race.
    if (needsDescendantReconcile) {
      await assertConfigDescendantsReconcilable(req.context, {
        ...config,
        ...fieldsToUpdate,
      } as ConfigInterface);
    }

    // Change-aware approval gate: value/schema changes require review under
    // requireReviews; metadata-only may be exempt.
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
