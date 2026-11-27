import {
  DashboardCommentThreadInterface,
  DashboardInterface,
} from "shared/enterprise";
import { ReqContext } from "back-end/types/request";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { assertDashboardBuilderOn } from "back-end/src/enterprise/services/dashboardVersions";

async function getDashboard(context: ReqContext, dashboardId: string) {
  // Reading the dashboard is what gates reading its comments.
  const dashboard = await context.models.dashboards.getById(dashboardId);
  if (!dashboard) throw new NotFoundError("Cannot find dashboard.");
  return dashboard;
}

async function getCommentableDashboard(
  context: ReqContext,
  dashboardId: string,
) {
  assertDashboardBuilderOn(context);
  const dashboard = await getDashboard(context, dashboardId);
  if (!context.permissions.canAddComment(dashboard.projects ?? [])) {
    context.permissions.throwPermissionError();
  }
  return dashboard;
}

// Threads started on the draft stay with the people who can see the draft.
function canSeeThread(
  context: ReqContext,
  dashboard: DashboardInterface,
  thread: DashboardCommentThreadInterface,
) {
  return (
    thread.version <= (dashboard.publishedVersion ?? 1) ||
    context.models.dashboards.canEdit(dashboard)
  );
}

export async function getDashboardComments(
  context: ReqContext,
  dashboardId: string,
): Promise<DashboardCommentThreadInterface[]> {
  const dashboard = await getDashboard(context, dashboardId);
  const threads =
    await context.models.dashboardComments.getAllForDashboard(dashboardId);
  return threads.filter((t) => canSeeThread(context, dashboard, t));
}

// Changes one thread the caller may see, retrying if someone else wrote to it first.
async function updateThread(
  context: ReqContext,
  dashboardId: string,
  threadId: string,
  change: (
    thread: DashboardCommentThreadInterface,
  ) => Partial<Pick<DashboardCommentThreadInterface, "comments" | "resolved">>,
): Promise<DashboardCommentThreadInterface> {
  const dashboard = await getCommentableDashboard(context, dashboardId);
  const threads = context.models.dashboardComments;
  const thread = await threads.getById(threadId);
  if (
    !thread ||
    thread.dashboardId !== dashboardId ||
    !canSeeThread(context, dashboard, thread)
  ) {
    throw new NotFoundError("Cannot find that comment thread.");
  }
  const updated = await threads.updateWithCas(
    thread.id,
    ["dateUpdated"],
    change,
  );
  if (!updated) throw new NotFoundError("Cannot find that comment thread.");
  return updated;
}

// Starts a thread on a block, or replies to one when threadId is given.
export async function addDashboardComment(
  context: ReqContext,
  dashboardId: string,
  input: {
    threadId?: string;
    blockId?: string;
    version?: number;
    annotationDate?: string;
    content: string;
  },
): Promise<DashboardCommentThreadInterface> {
  const content = input.content.trim();
  if (!content) throw new BadRequestError("A comment cannot be empty.");
  const comment = { userId: context.userId, content, date: new Date() };

  if (input.threadId) {
    return updateThread(context, dashboardId, input.threadId, (thread) => ({
      comments: [...thread.comments, comment],
      resolved: false,
    }));
  }
  await getCommentableDashboard(context, dashboardId);
  if (!input.blockId || !input.version) {
    throw new BadRequestError("A new comment needs a block and a version.");
  }
  return context.models.dashboardComments.create({
    dashboardId,
    blockId: input.blockId,
    version: input.version,
    ...(input.annotationDate ? { annotationDate: input.annotationDate } : {}),
    comments: [comment],
  });
}

export function resolveDashboardComment(
  context: ReqContext,
  dashboardId: string,
  threadId: string,
  resolved: boolean,
): Promise<DashboardCommentThreadInterface> {
  return updateThread(context, dashboardId, threadId, () => ({ resolved }));
}
