import { Revision } from "shared/enterprise";
import {
  postConstantValidator,
  validateConstantValue,
} from "shared/validators";
import { ConstantInterface } from "shared/types/constant";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { assertNoConstantCycle } from "back-end/src/services/constants";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import {
  buildPatchOps,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";

export const postConstant = createApiRequestHandler(postConstantValidator)(
  async (req) => {
    const {
      key,
      name,
      type,
      value,
      environmentValues,
      description,
      project,
      owner,
    } = req.body;
    const bypassApproval = req.body.bypassApproval === true;

    if (
      !req.context.permissions.canCreateConstant({ project: project || "" })
    ) {
      req.context.permissions.throwPermissionError();
    }

    if (project) {
      await req.context.models.projects.ensureProjectsExist([project]);
    }

    // Key is unique per org.
    const existing = await req.context.models.constants.getByKey(key);
    if (existing) {
      throw new BadRequestError(`A constant with key "${key}" already exists`);
    }

    // Validate value shape against the declared type (empty is allowed).
    if (value !== undefined) validateConstantValue(type, value, "value");
    for (const [env, v] of Object.entries(environmentValues ?? {})) {
      validateConstantValue(type, v, env);
    }

    // Reject values that would close a reference cycle.
    await assertNoConstantCycle(req.context, key, value, environmentValues);

    // Approval gate. Scope it to the new constant's project (change-aware, like
    // the update path) rather than the coarse org-wide check, so a create in a
    // project without a review rule isn't gated. There's no existing entity to
    // draft against on create, so the only non-UI path when approval is required
    // is bypass.
    const adapter = getAdapter("constant");
    const patchOps = buildPatchOps({
      ...(value !== undefined ? { value } : {}),
      ...(environmentValues ? { environmentValues } : {}),
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
          "This organization requires approvals for this constant's project. " +
            "Create it through the GrowthBook UI's approval flow, " +
            'or pass `{ "bypassApproval": true }` if you have the bypass permission.',
        );
      }
      const canBypass =
        !!req.organization.settings?.restApiBypassesReviews ||
        adapter.canBypassApproval(req.context, {
          project: project || "",
        } as ConstantInterface);
      if (!canBypass) {
        req.context.permissions.throwPermissionError();
      }
    }

    const constant = await req.context.models.constants.create({
      key,
      name,
      type,
      value,
      environmentValues,
      description,
      project: project || "",
      // Falls back to the authenticated user (Personal Access Tokens) when no
      // owner is provided.
      owner: owner || req.context.userId || "",
    });

    // Backfill a live (published) revision so the constant is immediately
    // editable through the revision system (mirrors the internal controller).
    await ensureLiveRevisionExists(
      req.context,
      "constant",
      constant as unknown as Record<string, unknown> & {
        id: string;
        owner?: string;
        dateCreated?: Date;
      },
    );

    return {
      constant: await resolveOwnerEmail(
        req.context.models.constants.toApiInterface(constant),
        req.context,
      ),
    };
  },
);
