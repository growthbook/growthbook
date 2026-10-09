import type { ConfirmationInterface, ConfirmLabel } from "shared/validators";
import type { Permissions } from "shared/permissions";
import type { ReqContext } from "back-end/types/request";
import { dispatchInternal, HttpMethod } from "back-end/src/agent/dispatcher";
import { getContextForApiKeyIdInOrg } from "back-end/src/services/organizations";
import { toApiConfirmation } from "back-end/src/services/confirmations";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";

const REVISION_MODELS = {
  feature: "feature",
  savedGroup: "saved-group",
  constant: "constant",
  config: "config",
} as const;

// For keys that name no one: the decider must be allowed to do the action
// themselves. `null` environments mean "any", where an empty list fails closed.
function deciderCan(
  p: Permissions,
  action: ConfirmLabel,
  project: string,
  envs: string[],
): boolean {
  const [model, verb] = action.split(".");
  const scope = envs.length ? envs : null;
  if (model in REVISION_MODELS) {
    return p.canRevisionAction(
      REVISION_MODELS[model as keyof typeof REVISION_MODELS],
      verb === "delete" || verb === "archive" ? "delete" : "publish",
      { project },
      scope,
    );
  }
  if (model === "rampSchedule") {
    return p.canRevisionAction("feature", "publish", { project }, scope);
  }
  if (model === "experiment") return p.canRunExperiment({ project }, envs);
  // Overrides: warnings need no authority; the rest need bypass rights.
  return (
    verb === "ignoreWarnings" ||
    p.canBypassFlagApprovalChecks({ project }, "feature")
  );
}

export function canDecide(
  context: ReqContext,
  c: ConfirmationInterface,
): boolean {
  if (c.userId) return c.userId === context.userId;
  return c.actions.every(({ action, environments }) =>
    deciderCan(context.permissions, action, c.project, environments),
  );
}

export async function getConfirmationForDecider(
  context: ReqContext,
  id: string,
) {
  const c = await context.models.confirmations.getById(id);
  if (!c) throw new NotFoundError("Could not find that confirmation");
  return c;
}

// The first decision wins. Confirm replays the held request as its original
// credential; the hold inside it sees `confirmationId` and lets the write through.
export async function decideConfirmation(
  context: ReqContext,
  id: string,
  decision: "confirm" | "reject",
  note?: string,
) {
  const c = await getConfirmationForDecider(context, id);
  if (!canDecide(context, c)) context.permissions.throwPermissionError();

  const confirmations = context.models.confirmations;
  const claimed = await confirmations.updateWithCas(id, ["status"], (doc) =>
    doc.status === "pending" && doc.expiresAt > new Date()
      ? {
          status: decision === "confirm" ? "running" : "rejected",
          decidedBy: context.userId ?? null,
          decidedAt: new Date(),
          rejectionNote: decision === "reject" ? note || null : null,
        }
      : null,
  );
  if (!claimed) {
    throw new BadRequestError(
      "This request was already decided or has expired.",
    );
  }
  if (decision === "reject") return toApiConfirmation(claimed);

  const requester = await getContextForApiKeyIdInOrg(context.org, c.apiKeyId);
  if (!requester) {
    await confirmations.updateWithCas(id, ["status"], () => ({
      status: "expired",
    }));
    throw new BadRequestError(
      "The key that made this request is gone, disabled or expired.",
    );
  }
  requester.confirmationId = id;
  requester.dispatchedRequest = { body: c.body, query: c.query };
  const response = await dispatchInternal(
    requester,
    {
      method: c.method as HttpMethod,
      path: c.path,
      query: c.query,
      body: c.body,
    },
    { includeDeprecated: true },
  );

  const done = await confirmations.updateWithCas(id, ["status"], (doc) =>
    doc.status === "running" ? { status: "completed", response } : null,
  );
  return toApiConfirmation(
    done ?? (await getConfirmationForDecider(context, id)),
  );
}
