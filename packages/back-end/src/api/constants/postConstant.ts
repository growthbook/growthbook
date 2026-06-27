import { Revision } from "shared/enterprise";
import {
  postConstantValidator,
  validateResolvableValue,
} from "shared/validators";
import { ConstantInterface } from "shared/types/constant";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError } from "back-end/src/util/errors";
import { assertKeyAvailable } from "back-end/src/services/constants";
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

    // Constant keys are unique within the constant namespace (a config may share
    // the key — `@const:foo` and `@config:foo` are distinct).
    await assertKeyAvailable(req.context, key, "constant");

    // Validate value shape against the declared type (empty is allowed).
    if (value !== undefined)
      validateResolvableValue({
        type,
        value,
        label: "value",
        refSource: "constant",
      });
    for (const [env, v] of Object.entries(environmentValues ?? {})) {
      validateResolvableValue({
        type,
        value: v,
        label: env,
        refSource: "constant",
      });
    }

    // Cycle rejection is enforced in ConstantModel (covers every write path).

    // Approval gate. Scope it to the new constant's project (change-aware, like
    // the update path) rather than the coarse org-wide check, so a create in a
    // project without a review rule isn't gated. There's no existing entity to
    // draft against on create, so the only non-UI path when approval is required
    // is bypass.
    const adapter = getAdapter("constant");
    // Include metadata fields too (not just value/env), so a metadata-only
    // create is still gated when the project requires metadata review.
    const patchOps = buildPatchOps({
      name,
      ...(value !== undefined ? { value } : {}),
      ...(environmentValues ? { environmentValues } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(project ? { project } : {}),
      ...(owner ? { owner } : {}),
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
