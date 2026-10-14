import type { ConfirmationInterface, ConfirmAction } from "shared/validators";
import type { Permissions } from "shared/permissions";
import type { ReqContext } from "back-end/types/request";
import { dispatchInternal, HttpMethod } from "back-end/src/agent/dispatcher";
import { getContextForApiKeyIdInOrg } from "back-end/src/services/organizations";
import { encodeArmingApiKeyId } from "back-end/src/util/armingApiKeyId";
import { toApiConfirmation } from "back-end/src/services/confirmations";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { auditDetailsCreate } from "back-end/src/services/audit";
import { getEnvironmentIdsFromOrg } from "back-end/src/util/organization.util";

const REVISION_MODELS = {
  feature: "feature",
  savedGroup: "saved-group",
  constant: "constant",
  config: "config",
} as const;

// The model whose bypass rights an override needs: what the request changes.
const BYPASS_MODELS: Record<string, "feature" | "config" | "constant"> = {
  feature: "feature",
  experiment: "feature",
  rampSchedule: "feature",
  constant: "constant",
  config: "config",
};

// For keys that name no one: the decider must be allowed to do the action
// themselves, in each of these environments.
function deciderCan(
  p: Permissions,
  action: ConfirmAction,
  project: string,
  envs: string[],
  changes: string,
): boolean {
  const [model, verb] = action.split(".");
  if (model in REVISION_MODELS) {
    return p.canRevisionAction(
      REVISION_MODELS[model as keyof typeof REVISION_MODELS],
      verb === "delete" || verb === "archive" ? "delete" : "publish",
      { project },
      envs,
    );
  }
  if (model === "rampSchedule") {
    return p.canRevisionAction("feature", "publish", { project }, envs);
  }
  if (model === "experiment") return p.canRunExperiment({ project }, envs);
  // Overrides: warnings need no authority; the rest need bypass rights on
  // whatever the request changes.
  if (verb === "ignoreWarnings") return true;
  return changes === "savedGroup"
    ? p.canRevisionAction("saved-group", "bypass", { project })
    : p.canBypassFlagApprovalChecks(
        { project },
        BYPASS_MODELS[changes] ?? "feature",
      );
}

export async function canDecide(
  context: ReqContext,
  c: ConfirmationInterface,
): Promise<boolean> {
  if (c.userId) return c.userId === context.userId;
  // A hold that didn't know where the change lands could land anywhere, so
  // the decider must be allowed everywhere.
  const projects = c.project
    ? [c.project]
    : ["", ...(await context.models.projects.getAllIdsForOrg())];
  const allEnvironments = getEnvironmentIdsFromOrg(context.org);
  const actions = c.requested ?? c.actions;
  const changes =
    actions
      .find(({ action }) => !action.startsWith("override."))
      ?.action.split(".")[0] ?? "feature";
  return actions.every(({ action, environments }) =>
    projects.every((project) =>
      deciderCan(
        context.permissions,
        action,
        project,
        environments.length ? environments : allEnvironments,
        changes,
      ),
    ),
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

const failure = (e: unknown) => ({
  status: 500,
  body: { message: e instanceof Error ? e.message : String(e) },
});

// The first decision wins. Confirm replays the held request as its original
// credential; the hold inside it sees `confirmationId` and lets the write through.
export async function decideConfirmation(
  context: ReqContext,
  id: string,
  decision: "confirm" | "reject",
  note?: string,
) {
  const c = await getConfirmationForDecider(context, id);
  if (!(await canDecide(context, c))) {
    context.permissions.throwPermissionError();
  }

  const confirmations = context.models.confirmations;
  const claimed = await confirmations.updateWithCas(id, ["status"], (doc) =>
    doc.status === "pending" && doc.expiresAt > new Date()
      ? {
          status: decision === "confirm" ? "running" : "rejected",
          decidedBy: context.userId ?? null,
          decidedAt: new Date(),
          note: note || null,
        }
      : null,
  );
  if (!claimed) {
    throw new BadRequestError(
      "This request was already decided or has expired.",
    );
  }
  // Once claimed it always finishes, so the agent polling it sees why.
  let response: { status: number; body: unknown };
  try {
    const key = await context.models.apiKeys.dangerousGetById(c.apiKeyId);
    await context.auditLog({
      event: decision === "confirm" ? "apiKey.confirm" : "apiKey.reject",
      entity: { object: "apiKey", id: c.apiKeyId, name: key?.description },
      details: auditDetailsCreate({
        confirmation: c.id,
        summary: c.summary,
        actions: c.actions,
        note: claimed.note,
      }),
    });
    if (decision === "reject") return toApiConfirmation(claimed);

    const requester = await getContextForApiKeyIdInOrg(
      context.org,
      encodeArmingApiKeyId(
        c.apiKeyId,
        c.assumedRole ? c.requestedBy?.id : undefined,
      ),
    );
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
    response = await dispatchInternal(
      requester,
      {
        method: c.method as HttpMethod,
        path: c.path,
        query: c.query,
        body: c.body,
      },
      { includeDeprecated: true },
    ).catch(failure);
  } catch (e) {
    await confirmations.updateWithCas(id, ["status"], (doc) =>
      doc.status === "running"
        ? { status: "completed", response: failure(e) }
        : null,
    );
    throw e;
  }

  const done = await confirmations.updateWithCas(id, ["status"], (doc) =>
    doc.status === "running" ? { status: "completed", response } : null,
  );
  return toApiConfirmation(
    done ?? (await getConfirmationForDecider(context, id)),
  );
}
