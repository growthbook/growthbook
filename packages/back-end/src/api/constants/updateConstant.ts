import { isEqual } from "lodash";
import { Revision, getConstantRevisionChange } from "shared/enterprise";
import {
  updateConstantValidator,
  validateResolvableValue,
} from "shared/validators";
import { ConstantInterface } from "shared/types/constant";
import { landDirectChange } from "back-end/src/revisions/revertActions";
import type { BypassedGate } from "back-end/src/revisions/publishGates";
import { runGuardedWrite } from "back-end/src/revisions/landingSequence";
import { holdsMoveDestination } from "back-end/src/revisions/moveAuthority";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import { constantPublishEnvironments } from "back-end/src/revisions/revisionPublishEnvironments";
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
      throw new NotFoundError(`Unable to locate the Constant: ${key}`);
    }

    // Authoring gate; the landing gate is below. A move is checked on both
    // sides — you need authoring rights in the project you're taking it out of
    // and the one you're putting it into.
    if (
      !req.context.permissions.canRevisionAction(
        "constant",
        "draft",
        constant,
      ) ||
      !req.context.permissions.canRevisionAction("constant", "draft", {
        projects: [project ?? constant.project ?? ""],
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
    // This endpoint always lands the change live (there's no draft mode), so it
    // needs publish authority on top of edit — same rule as the internal PUT.
    // Open a draft via POST /constants-revisions/:key without it.
    if (
      !req.context.permissions.canRevisionAction(
        "constant",
        "publish",
        constant,
        constantPublishEnvironments(
          req.context,
          getConstantRevisionChange(
            constant,
            buildPatchOps(fieldsToUpdate as Record<string, unknown>),
          ).changedEnvironments,
        ),
      )
    ) {
      req.context.permissions.throwPermissionError();
    }
    // Landing a move takes publish in the destination too.
    if (
      !holdsMoveDestination({
        permissions: req.context.permissions,
        model: "constant",
        action: "publish",
        existing: constant,
        proposed: {
          ...constant,
          ...(project === undefined ? {} : { project }),
        },
        environments: constantPublishEnvironments(
          req.context,
          getConstantRevisionChange(
            constant,
            buildPatchOps(fieldsToUpdate as Record<string, unknown>),
          ).changedEnvironments,
        ),
      })
    ) {
      req.context.permissions.throwPermissionError();
    }

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

    // See updateConfig: this route enforces approval itself, so it reports its own
    // bypass rather than inheriting one from the gate pipeline.
    const bypassedGates: BypassedGate[] = [];
    if (approvalRequired) {
      if (!bypassApproval) {
        throw new BadRequestError(
          "This organization requires approvals for this Constant. " +
            `Use \`POST /constants-revisions/${constant.key}\` to open a draft, ` +
            'or pass `{ "bypassApproval": true }` if you have the bypass permission.',
        );
      }
      const viaRestSetting = canUseRestApiBypassSetting(req);
      const canBypass =
        viaRestSetting || adapter.canBypassApproval(req.context, constant);
      if (!canBypass) {
        req.context.permissions.throwPermissionError();
      }
      bypassedGates.push({
        type: "approval-required",
        outcome: "bypassed",
        via: viaRestSetting
          ? "restApiBypassesReviews"
          : "bypassApprovalPermission",
      });
    }

    // One landing path whether or not approval was bypassed: every direct
    // update is recorded and guarded. History first, then live state — a merged
    // record with no live change is removable; the reverse is unrepairable.
    await ensureLiveRevisionExists(
      req.context,
      "constant",
      constant as unknown as Record<string, unknown> & {
        id: string;
        owner?: string;
        dateCreated?: Date;
      },
    );
    const { merged, result: updated } = await landDirectChange({
      context: req.context,
      entityType: "constant",
      entity: constant as unknown as Record<string, unknown> & { id: string },
      patchOps,
      // Marks a skipped approval requirement; an org without one skips nothing.
      bypass: approvalRequired,
      changes: fieldsToUpdate as Record<string, unknown>,
      // Reports from INSIDE the write. `persistedFrom` maps the RETURN VALUE, so it
      // never runs when the write throws after persisting — compensation then read
      // "nothing written", removed the merged revision, and left the change live
      // with no record of it at all.
      write: (report) =>
        runGuardedWrite("constant", constant.id, () =>
          req.context.models.constants.updateIfUnchanged(
            constant,
            fieldsToUpdate,
            undefined,
            {
              onWritten: (doc: unknown) =>
                report(doc as Record<string, unknown>),
            },
          ),
        ),
      persistedFrom: (written) => written as unknown as Record<string, unknown>,
    });
    // Fire the revision-published event so REST publishes are observable like
    // every other publish path (the internal merge path and the revert handler
    // both dispatch this; createMerged itself does not).
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
      ...(bypassedGates.length ? { bypassedGates } : {}),
    };
  },
);
