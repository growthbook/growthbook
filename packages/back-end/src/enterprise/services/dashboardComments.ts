import { DashboardCommentThreadInterface } from "shared/enterprise";
import { ReqContext } from "back-end/types/request";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";

async function getDashboard(context: ReqContext, dashboardId: string) {
  // Reading the dashboard is what gates reading its comments.
  const dashboard = await context.models.dashboards.getById(dashboardId);
  if (!dashboard) throw new NotFoundError("Cannot find dashboard");
  return dashboard;
}

async function getCommentableDashboard(
  context: ReqContext,
  dashboardId: string,
) {
  const dashboard = await getDashboard(context, dashboardId);
  if (!context.permissions.canAddComment(dashboard.projects ?? [])) {
    context.permissions.throwPermissionError();
  }
  return dashboard;
}

export async function getDashboardComments(
  context: ReqContext,
  dashboardId: string,
): Promise<DashboardCommentThreadInterface[]> {
  const dashboard = await getDashboard(context, dashboardId);
  const threads =
    await context.models.dashboardComments.getAllForDashboard(dashboardId);
  // Threads started on the draft stay with the people who can see the draft.
  return context.models.dashboards.canEdit(dashboard)
    ? threads
    : threads.filter((t) => t.version <= (dashboard.publishedVersion ?? 1));
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
  await getCommentableDashboard(context, dashboardId);
  const content = input.content.trim();
  if (!content) throw new BadRequestError("A comment cannot be empty");
  const comment = { userId: context.userId, content, date: new Date() };
  const threads = context.models.dashboardComments;

  if (input.threadId) {
    const thread = await threads.getById(input.threadId);
    if (!thread || thread.dashboardId !== dashboardId) {
      throw new NotFoundError("Cannot find that comment thread");
    }
    return threads.update(thread, {
      comments: [...thread.comments, comment],
      resolved: false,
    });
  }
  if (!input.blockId || !input.version) {
    throw new BadRequestError("A new comment needs a block and a version");
  }
  return threads.create({
    dashboardId,
    blockId: input.blockId,
    version: input.version,
    ...(input.annotationDate ? { annotationDate: input.annotationDate } : {}),
    comments: [comment],
  });
}

export async function resolveDashboardComment(
  context: ReqContext,
  dashboardId: string,
  threadId: string,
  resolved: boolean,
): Promise<DashboardCommentThreadInterface> {
  await getCommentableDashboard(context, dashboardId);
  const thread = await context.models.dashboardComments.getById(threadId);
  if (!thread || thread.dashboardId !== dashboardId) {
    throw new NotFoundError("Cannot find that comment thread");
  }
  return context.models.dashboardComments.update(thread, { resolved });
}
