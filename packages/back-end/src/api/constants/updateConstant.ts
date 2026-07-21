import { isEqual } from "lodash";
import { Revision } from "shared/enterprise";
import {
  updateConstantValidator,
  validateResolvableValue,
} from "shared/validators";
import { ConstantInterface } from "shared/types/constant";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import { canUseRestApiBypassSetting } from "back-end/src/api/features/reviewBypass";
import {
  buildPatchOps,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
import { assertConstantPublishGuards } from "back-end/src/services/publishGuards";
import { constantChangeAffectsServedValue } from "back-end/src/services/experimentGuard";
import { dispatchConstantRevisionEvent } from "back-end/src/services/constantRevisionEvents";

export const updateConstant = createApiRequestHandler(updateConstantValidator)(
  async (req) => {
    const { key } = req.params;
    const { name, value, environmentValues, description, project, owner } =
      req.body;
    const bypassApproval = req.body.bypassApproval === true;

    const constant = await req.context.models.constants.getByKey(key);
    if (!constant) {
      throw new NotFoundError(`Unable to locate the constant: ${key}`);
    }

    if (
      !req.context.permissions.canUpdateConstant(constant, {
        project: project ?? constant.project,
      })
    ) {
      req.context.permissions.throwPermissionError();
    }

    // Omit protected base fields so the type lines up with the model's
    // UpdateProps (which forbids id/organization/dateCreated/dateUpdated).
    const fieldsToUpdate: Partial<
      Omit<
        ConstantInterface,
        "id" | "organization" | "dateCreated" | "dateUpdated"
      >
    > = {};
    if (name !== undefined && name !== constant.name) {
      fieldsToUpdate.name = name;
    }
    if (owner !== undefined && owner !== constant.owner) {
      fieldsToUpdate.owner = owner;
    }
    if (description !== undefined && description !== constant.description) {
      fieldsToUpdate.description = description;
    }
    if (project !== undefined && project !== constant.project) {
      if (project) {
        await req.context.models.projects.ensureProjectsExist([project]);
      }
      fieldsToUpdate.project = project;
    }
    if (value !== undefined && value !== constant.value) {
      validateResolvableValue({
        type: constant.type,
        value,
        label: "value",
        refSource: "constant",
      });
      fieldsToUpdate.value = value;
    }
    if (
      environmentValues !== undefined &&
      !isEqual(environmentValues, constant.environmentValues)
    ) {
      for (const [env, v] of Object.entries(environmentValues)) {
        validateResolvableValue({
          type: constant.type,
          value: v,
          label: env,
          refSource: "constant",
        });
      }
      fieldsToUpdate.environmentValues = environmentValues;
    }

    // Cycle rejection is enforced in ConstantModel (covers every write path,
    // including the publish/applyChanges merge).

    if (Object.keys(fieldsToUpdate).length === 0) {
      return {
        constant: await resolveOwnerEmail(
          req.context.models.constants.toApiInterface(constant),
          req.context,
        ),
      };
    }

    // Deferred-publish guards (direct publish → armed:false): every non-throwing
    // path below applies live, and none of them run assertPublishable, so
    // enforce the guards here — mirroring the config REST update. Skipped for a
    // metadata-only update (can't rewrite a served value).
    if (constantChangeAffectsServedValue(Object.keys(fieldsToUpdate))) {
      await assertConstantPublishGuards(
        req.context,
        constant,
        { armAcknowledgments: undefined },
        { armed: false },
        fieldsToUpdate.value ?? constant.value,
        fieldsToUpdate.environmentValues ?? constant.environmentValues,
      );
    }

    // Change-aware approval gate (a value change always requires review when the
    // project has requireReviews; metadata-only may be exempt) — mirrors the
    // internal PUT controller and the saved-group REST update.
    const adapter = getAdapter("constant");
    const patchOps = buildPatchOps(fieldsToUpdate as Record<string, unknown>);
    // The constant adapter reads `target.snapshot` (for the project + the
    // value/env-change diff), so the snapshot must be the current constant — not
    // just the proposed changes.
    const approvalRequired = adapter.isApprovalRequiredForRevision
      ? adapter.isApprovalRequiredForRevision(req.context, {
          target: { snapshot: constant, proposedChanges: patchOps },
        } as unknown as Revision)
      : adapter.isApprovalRequired(req.context);

    if (approvalRequired) {
      if (!bypassApproval) {
        throw new BadRequestError(
          "This organization requires approvals for this constant. " +
            `Use \`POST /constants-revisions/${constant.key}\` to open a draft, ` +
            'or pass `{ "bypassApproval": true }` if you have the bypass permission.',
        );
      }
      const canBypass =
        canUseRestApiBypassSetting(req) ||
        adapter.canBypassApproval(req.context, constant);
      if (!canBypass) {
        req.context.permissions.throwPermissionError();
      }

      // Record the already-merged revision FIRST, then apply it to the live
      // entity, rolling the revision back if the apply fails — so we never leave
      // a merged record with no corresponding live change (mirrors the revert
      // handler's record-first-then-rollback ordering).
      await ensureLiveRevisionExists(
        req.context,
        "constant",
        constant as unknown as Record<string, unknown> & {
          id: string;
          owner?: string;
          dateCreated?: Date;
        },
      );
      const merged = await req.context.models.revisions.createMerged({
        type: "constant",
        id: constant.id,
        snapshot: constant as unknown as Record<string, unknown>,
        proposedChanges: patchOps,
        bypass: true,
      });
      let updated: Partial<ConstantInterface>;
      try {
        updated = await req.context.models.constants.update(
          constant,
          fieldsToUpdate,
        );
      } catch (e) {
        try {
          await req.context.models.revisions.deleteById(merged.id);
        } catch {
          // ignore — surface the original update error
        }
        throw e;
      }
      // Fire the revision-published event so REST-bypass publishes are
      // observable like every other publish path (the internal merge path and
      // the revert handler both dispatch this; createMerged itself does not).
      await dispatchConstantRevisionEvent(req.context, merged, {
        type: "published",
      });
      return {
        constant: await resolveOwnerEmail(
          req.context.models.constants.toApiInterface({
            ...constant,
            ...updated,
          }),
          req.context,
        ),
      };
    }

    const updated = await req.context.models.constants.update(
      constant,
      fieldsToUpdate,
    );
    return {
      constant: await resolveOwnerEmail(
        req.context.models.constants.toApiInterface({
          ...constant,
          ...updated,
        }),
        req.context,
      ),
    };
  },
);
