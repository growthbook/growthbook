import type { ConfirmationInterface, ConfirmAction } from "shared/validators";
import type { Permissions } from "shared/permissions";
import type { ReqContext } from "back-end/types/request";
import { dispatchInternal, HttpMethod } from "back-end/src/agent/dispatcher";
import { getContextForApiKeyIdInOrg } from "back-end/src/services/organizations";
import { encodeArmingApiKeyId } from "back-end/src/util/armingApiKeyId";
import { toApiConfirmation } from "back-end/src/services/confirmations";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { auditDetailsCreate } from "back-end/src/services/audit";

const REVISION_MODELS = {
  feature: "feature",
  savedGroup: "saved-group",
  constant: "constant",
  config: "config",
} as const;

// For keys that name no one: the decider must be allowed to do the action
// themselves, in each of these environments. Anything unlisted fails closed.
function deciderCan(
  p: Permissions,
  action: ConfirmAction,
  project: string,
  envs: string[],
  changes: string,
): boolean {
  const [model, verb] = action.split(".");
  const projects = project ? [project] : [];
  const scoped = { projects, managedBy: "" as const };
  const byVerb = (
    create: () => boolean,
    edit: () => boolean,
    remove: () => boolean,
  ) => (verb === "create" ? create() : verb === "delete" ? remove() : edit());
  switch (model) {
    case "feature":
    case "savedGroup":
    case "constant":
    case "config":
      return p.canRevisionAction(
        REVISION_MODELS[model],
        verb === "create" || verb === "draft"
          ? verb
          : verb === "delete" || verb === "archive"
            ? "delete"
            : "publish",
        { project },
        envs,
      );
    case "rampSchedule":
      return p.canRevisionAction("feature", "publish", { project }, envs);
    case "experiment":
      return verb === "create"
        ? p.canCreateExperiment({ project })
        : verb === "draft"
          ? p.canUpdateExperiment({ project }, { project })
          : p.canRunExperiment({ project }, envs);
    case "settings":
    case "other":
      return p.canManageOrgSettings();
    case "access":
      return p.canManageTeam();
    case "customField":
      return p.canManageCustomFields();
    case "customHook":
      return byVerb(
        () => p.canCreateCustomHook({ projects }),
        () => p.canUpdateCustomHook({ projects }, { projects }),
        () => p.canDeleteCustomHook({ projects }),
      );
    case "environment":
      return envs.every((id) =>
        byVerb(
          () => p.canCreateEnvironment({ projects, id }),
          () => p.canUpdateEnvironment({ projects, id }, { projects }),
          () => p.canDeleteEnvironment({ projects, id }),
        ),
      );
    case "project":
      return byVerb(
        () => p.canCreateProjects(),
        () => p.canUpdateProject(project),
        () => p.canDeleteProject(project),
      );
    case "attribute":
      return byVerb(
        () => p.canCreateAttribute({ projects }),
        () => p.canUpdateAttribute({ projects }, { projects }),
        () => p.canDeleteAttribute({ projects }),
      );
    case "sdkConnection":
      return envs.every((environment) =>
        byVerb(
          () => p.canCreateSDKConnection({ projects, environment }),
          () =>
            p.canUpdateSDKConnection(
              { projects, environment },
              { projects, environment },
            ),
          () => p.canDeleteSDKConnection({ projects, environment }),
        ),
      );
    // Metric actions cover metrics, fact metrics and metric groups alike.
    case "metric":
      return byVerb(
        () =>
          p.canCreateMetric(scoped) &&
          p.canCreateFactMetric(scoped) &&
          p.canCreateMetricGroup(),
        () =>
          p.canUpdateMetric(scoped, scoped) &&
          p.canUpdateFactMetric(scoped, {}) &&
          p.canUpdateMetricGroup(),
        () =>
          p.canDeleteMetric(scoped) &&
          p.canDeleteFactMetric(scoped) &&
          p.canDeleteMetricGroup(),
      );
    // Fact table actions cover their filters and virtual columns too.
    case "factTable":
      return byVerb(
        () =>
          p.canCreateFactTable(scoped) &&
          p.canCreateAndUpdateFactFilter(scoped) &&
          p.canManageFactTableVirtualColumn(scoped),
        () =>
          p.canUpdateFactTable(scoped, {}) &&
          p.canCreateAndUpdateFactFilter(scoped) &&
          p.canDeleteFactFilter(scoped) &&
          p.canManageFactTableVirtualColumn(scoped),
        () => p.canDeleteFactTable(scoped),
      );
    case "segment":
      return byVerb(
        () => p.canCreateSegment({ projects }),
        () => p.canUpdateSegment({ projects }, { projects }),
        () => p.canDeleteSegment({ projects }),
      );
    case "dimension":
      return byVerb(
        () => p.canCreateDimension(),
        () => p.canUpdateDimension(),
        () => p.canDeleteDimension(),
      );
    // Warnings need no authority; the other checks need bypass rights on
    // whatever the request changes, with experiments and ramps going by the flag.
    case "override":
      if (verb === "ignoreWarnings") return true;
      if (changes === "savedGroup") {
        return p.canRevisionAction("saved-group", "bypass", { project });
      }
      if (changes === "constant" || changes === "config") {
        return p.canBypassFlagApprovalChecks({ project }, changes);
      }
      if (
        changes === "feature" ||
        changes === "experiment" ||
        changes === "rampSchedule"
      ) {
        return p.canBypassFlagApprovalChecks({ project }, "feature");
      }
      return false;
    default:
      return false;
  }
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
  const allEnvironments = context.environments;
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
