import pick from "lodash/pick";
import {
  applyDashboardDraftOp,
  dashboardBlockHasIds,
  dashboardDraftChangeFromOp,
  DashboardDraftOp,
  DashboardDraftOpInput,
  DashboardInterface,
  DashboardVersionContent,
  DashboardVersionInterface,
  DASHBOARD_GRID_COLS,
  resolveGlobalControlsBlockEnrollment,
} from "shared/enterprise";
import { ReqContext } from "back-end/types/request";
import {
  generateDashboardBlockIds,
  normalizeLayouts,
} from "back-end/src/enterprise/models/DashboardModel";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "back-end/src/util/errors";

async function getEditableDashboard(context: ReqContext, dashboardId: string) {
  const dashboard = await context.models.dashboards.getById(dashboardId);
  if (!dashboard) throw new NotFoundError("Cannot find dashboard");
  if (dashboard.experimentId) {
    throw new BadRequestError("Experiment dashboards do not support drafts");
  }
  if (!context.models.dashboards.canEdit(dashboard)) {
    context.permissions.throwPermissionError();
  }
  return dashboard;
}

function contentOf(dashboard: DashboardInterface): DashboardVersionContent {
  return pick(dashboard, [
    "title",
    "blocks",
    "globalControls",
    "comparison",
    "grid",
  ]);
}

export async function getDashboardDraft(
  context: ReqContext,
  dashboardId: string,
): Promise<DashboardVersionInterface | null> {
  const dashboard = await getEditableDashboard(context, dashboardId);
  return context.models.dashboardVersions.getDraft(dashboard.id);
}

export async function getOrCreateDashboardDraft(
  context: ReqContext,
  dashboardId: string,
): Promise<DashboardVersionInterface> {
  const dashboard = await getEditableDashboard(context, dashboardId);
  const versions = context.models.dashboardVersions;
  const existing = await versions.getDraft(dashboard.id);
  if (existing) return existing;

  const content = contentOf(dashboard);
  let published = dashboard.publishedVersion ?? 0;
  try {
    // A dashboard saved before versioning becomes v1 the first time it is edited.
    if (!published && !dashboard.isDraft) {
      await versions.create({
        dashboardId: dashboard.id,
        version: 1,
        status: "published",
        content,
        changes: [],
        publishedBy: dashboard.userId,
        datePublished: dashboard.dateUpdated,
      });
      await context.models.dashboards.updateById(dashboard.id, {
        publishedVersion: 1,
      });
      published = 1;
    }
    return await versions.create({
      dashboardId: dashboard.id,
      version: published + 1,
      status: "draft",
      content,
      changes: [],
    });
  } catch (e) {
    // The unique index makes a concurrent create lose; use the winner's draft.
    const raced = await versions.getDraft(dashboard.id);
    if (raced) return raced;
    throw e;
  }
}

// ponytail: two edits to the same block are last-write-wins; add a per-block revision when editors collide.
export async function editDashboardDraft(
  context: ReqContext,
  dashboardId: string,
  input: DashboardDraftOpInput,
  options: { byAI?: boolean } = {},
): Promise<DashboardVersionInterface> {
  const draft = await getOrCreateDashboardDraft(context, dashboardId);
  const op: DashboardDraftOp =
    input.op === "add-block" && !dashboardBlockHasIds(input.block)
      ? {
          ...input,
          block: generateDashboardBlockIds(context.org.id, input.block),
        }
      : (input as DashboardDraftOp);
  const change = {
    ...dashboardDraftChangeFromOp(op),
    userId: context.userId,
    byAI: options.byAI,
    date: new Date(),
  };

  const updated = await context.models.dashboardVersions.updateWithCas(
    draft.id,
    ["dateUpdated"],
    (current) => {
      if (current.status !== "draft") return null;
      const content = applyDashboardDraftOp(current.content, op);
      return {
        content: {
          ...content,
          blocks: normalizeLayouts(
            content.blocks,
            content.grid?.cols ?? DASHBOARD_GRID_COLS,
          ),
        },
        changes: [...current.changes, change],
      };
    },
  );
  if (!updated) {
    throw new ConflictError("This draft was published or discarded");
  }
  return updated;
}

export async function publishDashboardDraft(
  context: ReqContext,
  dashboardId: string,
  note?: string,
): Promise<{
  dashboard: DashboardInterface;
  version: DashboardVersionInterface;
}> {
  const dashboard = await getEditableDashboard(context, dashboardId);
  const versions = context.models.dashboardVersions;
  const draft = await versions.getDraft(dashboard.id);
  if (!draft) throw new BadRequestError("There is no draft to publish");

  // Claim first so a second publish, or an edit racing this one, loses.
  const version = await versions.updateWithCas(
    draft.id,
    ["dateUpdated"],
    (current) =>
      current.status === "draft"
        ? {
            status: "published",
            publishedBy: context.userId,
            datePublished: new Date(),
            ...(note ? { note } : {}),
          }
        : null,
  );
  if (!version) throw new ConflictError("This draft was already published");

  try {
    const { content } = version;
    const blocks =
      resolveGlobalControlsBlockEnrollment({
        existingGlobalControls: dashboard.globalControls,
        nextGlobalControls: content.globalControls,
        nextBlocks: content.blocks,
      }) ?? content.blocks;
    const published = await context.models.dashboards.updateById(dashboard.id, {
      ...content,
      blocks,
      isDraft: false,
      publishedVersion: version.version,
    });
    return { dashboard: published, version };
  } catch (e) {
    await versions.update(version, { status: "draft" });
    throw e;
  }
}

export async function discardDashboardDraft(
  context: ReqContext,
  dashboardId: string,
): Promise<void> {
  const draft = await getDashboardDraft(context, dashboardId);
  if (draft) await context.models.dashboardVersions.delete(draft);
}
