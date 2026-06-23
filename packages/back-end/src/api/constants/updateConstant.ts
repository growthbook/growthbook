import { isEqual } from "lodash";
import { Revision } from "shared/enterprise";
import {
  updateConstantValidator,
  validateConstantValue,
} from "shared/validators";
import { ConstantInterface } from "shared/types/constant";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import {
  buildPatchOps,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
import { dispatchConstantRevisionEvent } from "back-end/src/services/constantRevisionEvents";

export const updateConstant = createApiRequestHandler(updateConstantValidator)(
  async (req) => {
    const { id } = req.params;
    const { name, value, environmentValues, description, project, owner } =
      req.body;
    const bypassApproval = req.body.bypassApproval === true;

    const constant = await req.context.models.constants.getById(id);
    if (!constant) {
      throw new NotFoundError(`Unable to locate the constant: ${id}`);
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
      validateConstantValue(constant.type, value, "value");
      fieldsToUpdate.value = value;
    }
    if (
      environmentValues !== undefined &&
      !isEqual(environmentValues, constant.environmentValues)
    ) {
      for (const [env, v] of Object.entries(environmentValues)) {
        validateConstantValue(constant.type, v, env);
      }
      fieldsToUpdate.environmentValues = environmentValues;
    }

    if (Object.keys(fieldsToUpdate).length === 0) {
      return {
        constant: await resolveOwnerEmail(
          req.context.models.constants.toApiInterface(constant),
          req.context,
        ),
      };
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
            `Use \`POST /constants/${constant.id}/revisions\` to open a draft, ` +
            'or pass `{ "bypassApproval": true }` if you have the bypass permission.',
        );
      }
      const canBypass =
        !!req.organization.settings?.restApiBypassesReviews ||
        adapter.canBypassApproval(req.context, constant);
      if (!canBypass) {
        req.context.permissions.throwPermissionError();
      }

      // Persist the live change first, then record it as an already-merged
      // revision (matches the saved-group REST update ordering).
      await ensureLiveRevisionExists(
        req.context,
        "constant",
        constant as unknown as Record<string, unknown> & {
          id: string;
          owner?: string;
          dateCreated?: Date;
        },
      );
      const updated = await req.context.models.constants.update(
        constant,
        fieldsToUpdate,
      );
      const merged = await req.context.models.revisions.createMerged({
        type: "constant",
        id: constant.id,
        snapshot: constant as unknown as Record<string, unknown>,
        proposedChanges: patchOps,
        bypass: true,
      });
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
