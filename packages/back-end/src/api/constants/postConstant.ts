import {
  postConstantValidator,
  validateResolvableValue,
} from "shared/validators";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { assertKeyAvailable } from "back-end/src/services/constants";
import { ensureLiveRevisionExists } from "back-end/src/revisions/util";

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

    // Creation never requires approval (consistent with features): a brand-new
    // constant has no dependents, so creating it can't change any resolved
    // value. Approvals apply to subsequent changes via the revision flow.

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
