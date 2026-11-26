import omit from "lodash/omit";
import pick from "lodash/pick";
import {
  apiCreateDashboardBlockInterface,
  ApiCreateDashboardBlockInterface,
  ApiDashboardDraft,
  applyDashboardDraftOp,
  dashboardBlockHasIds,
  dashboardDraftChangeFromOp,
  diffDashboardContent,
  DashboardDraftOp,
  DashboardDraftOpInput,
  DashboardInterface,
  DashboardVersionContent,
  DashboardVersionInterface,
  DashboardVersionSetting,
  DASHBOARD_GRID_COLS,
  resolveGlobalControlsBlockEnrollment,
} from "shared/enterprise";
import { ReqContext } from "back-end/types/request";
import {
  fromBlockApiInterface,
  generateDashboardBlockIds,
  normalizeLayouts,
  toBlockApiInterface,
} from "back-end/src/enterprise/models/DashboardModel";
import { runNewApiExplorationBlocks } from "back-end/src/enterprise/services/dashboards";
import { simpleCompletion } from "back-end/src/enterprise/services/ai";
import { currentRequestSource } from "back-end/src/services/growthbook";
import { logger } from "back-end/src/util/logger";
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

// The draft when the caller may edit, otherwise what is published.
export async function getDashboardWorkingContent(
  context: ReqContext,
  dashboardId: string,
): Promise<DashboardVersionContent> {
  const dashboard = await context.models.dashboards.getById(dashboardId);
  if (!dashboard) throw new NotFoundError("Cannot find dashboard");
  const draft = context.models.dashboards.canEdit(dashboard)
    ? await context.models.dashboardVersions.getDraft(dashboard.id)
    : null;
  return draft?.content ?? contentOf(dashboard);
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

// ponytail: whole-content snapshots; store per-change inverses if drafts get large.
const UNDO_STEPS = 20;

export async function undoDashboardDraft(
  context: ReqContext,
  dashboardId: string,
): Promise<DashboardVersionInterface> {
  const draft = await getDashboardDraft(context, dashboardId);
  const updated = draft
    ? await context.models.dashboardVersions.updateWithCas(
        draft.id,
        ["dateUpdated"],
        (current) => {
          const undo = current.undo ?? [];
          if (current.status !== "draft" || !undo.length) return null;
          return {
            content: undo[undo.length - 1],
            undo: undo.slice(0, -1),
            changes: current.changes.slice(0, -1),
          };
        },
      )
    : null;
  if (!updated) throw new BadRequestError("There is nothing to undo");
  return updated;
}

// ponytail: two edits to the same block are last-write-wins; add a per-block revision when editors collide.
export async function editDashboardDraft(
  context: ReqContext,
  dashboardId: string,
  input: DashboardDraftOpInput,
  // silent: part of a larger change, so no change record and no Undo step of its own.
  options: { byAI?: boolean; silent?: boolean } = {},
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
    // The assistant's API calls are marked where they are dispatched.
    byAI: options.byAI ?? (currentRequestSource() === "assistant" || undefined),
    date: new Date(),
  };

  const updated = await context.models.dashboardVersions.updateWithCas(
    draft.id,
    ["dateUpdated"],
    (current) => {
      if (current.status !== "draft") return null;
      const content = applyDashboardDraftOp(current.content, op);
      // Turning a dashboard-wide control on makes the existing blocks follow it.
      const blocks =
        op.op === "set-settings"
          ? (resolveGlobalControlsBlockEnrollment({
              existingGlobalControls: current.content.globalControls,
              nextGlobalControls: content.globalControls,
              nextBlocks: content.blocks,
            }) ?? content.blocks)
          : content.blocks;
      return {
        content: {
          ...content,
          blocks: normalizeLayouts(
            blocks,
            content.grid?.cols ?? DASHBOARD_GRID_COLS,
          ),
        },
        ...(options.silent
          ? {}
          : {
              changes: [...current.changes, change],
              undo: [...(current.undo ?? []), current.content].slice(
                -UNDO_STEPS,
              ),
            }),
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
            undo: [],
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

// The manual editor saves whole content; the draft's change list is derived from the difference.
export async function saveDashboardDraftContent(
  context: ReqContext,
  dashboardId: string,
  updates: Partial<DashboardVersionContent>,
): Promise<DashboardVersionInterface> {
  const draft = await getOrCreateDashboardDraft(context, dashboardId);
  const updated = await context.models.dashboardVersions.updateWithCas(
    draft.id,
    ["dateUpdated"],
    (current) => {
      if (current.status !== "draft") return null;
      const next = { ...current.content, ...updates };
      const content = {
        ...next,
        blocks: normalizeLayouts(
          resolveGlobalControlsBlockEnrollment({
            existingGlobalControls: current.content.globalControls,
            nextGlobalControls: next.globalControls,
            nextBlocks: next.blocks,
          }) ?? next.blocks,
          next.grid?.cols ?? DASHBOARD_GRID_COLS,
        ),
      };
      const changes = diffDashboardContent(current.content, content).map(
        ({ type, blockId }) => ({
          type: type === "block-moved" ? ("block-edited" as const) : type,
          blockId,
          userId: context.userId,
          date: new Date(),
        }),
      );
      if (!changes.length) return { content };
      return {
        content,
        changes: [...current.changes, ...changes],
        undo: [...(current.undo ?? []), current.content].slice(-UNDO_STEPS),
      };
    },
  );
  if (!updated) {
    throw new ConflictError("This draft was published or discarded");
  }
  return updated;
}

// Published versions for anyone who can read the dashboard; the draft only for its editors.
export async function getDashboardVersions(
  context: ReqContext,
  dashboardId: string,
): Promise<DashboardVersionInterface[]> {
  const dashboard = await context.models.dashboards.getById(dashboardId);
  if (!dashboard) throw new NotFoundError("Cannot find dashboard");
  const canEdit = context.models.dashboards.canEdit(dashboard);
  const versions = await context.models.dashboardVersions.getAllForDashboard(
    dashboard.id,
  );
  return versions
    .filter((v) => v.status === "published" || canEdit)
    .sort((a, b) => b.version - a.version)
    .map((v) => omit(v, "undo"));
}

// Copies an earlier version into the draft; nothing is live until that draft is published.
export async function restoreDashboardVersion(
  context: ReqContext,
  dashboardId: string,
  version: number,
): Promise<DashboardVersionInterface> {
  const source = (await getDashboardVersions(context, dashboardId)).find(
    (v) => v.version === version && v.status === "published",
  );
  if (!source) throw new NotFoundError("Cannot find that version");
  return saveDashboardDraftContent(context, dashboardId, source.content);
}

// Puts one block, or one dashboard setting, back to what is published.
export async function revertDashboardDraftChange(
  context: ReqContext,
  dashboardId: string,
  target: { blockId?: string; setting?: DashboardVersionSetting },
): Promise<DashboardVersionInterface> {
  const dashboard = await getEditableDashboard(context, dashboardId);
  const draft = await context.models.dashboardVersions.getDraft(dashboard.id);
  if (!draft) throw new BadRequestError("There is no draft to revert");
  const published = contentOf(dashboard);

  if (target.setting) {
    return saveDashboardDraftContent(context, dashboardId, {
      [target.setting]: published[target.setting],
    });
  }
  const at = draft.content.blocks.findIndex((b) => b.id === target.blockId);
  const blocks = draft.content.blocks.filter((b) => b.id !== target.blockId);
  const original = published.blocks.find((b) => b.id === target.blockId);
  if (original) {
    blocks.splice(
      at === -1 ? published.blocks.indexOf(original) : at,
      0,
      original,
    );
  }
  return saveDashboardDraftContent(context, dashboardId, { blocks });
}

// A version note drafted from the difference between the draft and what is published.
export async function summarizeDashboardDraft(
  context: ReqContext,
  dashboardId: string,
): Promise<string> {
  const dashboard = await getEditableDashboard(context, dashboardId);
  const draft = await context.models.dashboardVersions.getDraft(dashboard.id);
  const changes = draft
    ? diffDashboardContent(contentOf(dashboard), draft.content)
    : [];
  if (!draft || !changes.length) {
    throw new BadRequestError("This draft has no changes to summarize");
  }
  return simpleCompletion({
    context,
    type: "product-analytics-chat",
    isDefaultPrompt: true,
    temperature: 0.2,
    maxOutputTokens: 200,
    lowEffort: true,
    instructions:
      "Write a note for a dashboard's version history: one or two sentences saying what changed, for someone deciding whether to open this version. Plain text, no markdown, no preamble.",
    prompt: `Dashboard: ${draft.content.title}\nChanges:\n${changes
      .map((c) => `- ${c.summary}`)
      .join("\n")}`,
  });
}

export async function discardDashboardDraft(
  context: ReqContext,
  dashboardId: string,
): Promise<void> {
  const draft = await getDashboardDraft(context, dashboardId);
  if (draft) await context.models.dashboardVersions.delete(draft);
}

// Runs the chart so a block only reaches the draft with data behind it.
async function runDraftBlock(
  context: ReqContext,
  content: DashboardVersionContent,
  apiBlock: ApiCreateDashboardBlockInterface,
) {
  const [ran] = await runNewApiExplorationBlocks(context, [apiBlock], content);
  return generateDashboardBlockIds(context.org.id, fromBlockApiInterface(ran));
}

export async function addDashboardDraftBlock(
  context: ReqContext,
  dashboardId: string,
  apiBlock: ApiCreateDashboardBlockInterface,
) {
  const { content } = await getOrCreateDashboardDraft(context, dashboardId);
  const block = await runDraftBlock(context, content, apiBlock);
  const draft = await editDashboardDraft(context, dashboardId, {
    op: "add-block",
    block,
  });
  return { draft, block };
}

export async function replaceDashboardDraftBlock(
  context: ReqContext,
  dashboardId: string,
  blockId: string,
  apiBlock: ApiCreateDashboardBlockInterface,
  options: { silent?: boolean } = {},
) {
  const { content } = await getOrCreateDashboardDraft(context, dashboardId);
  const existing = content.blocks.find((b) => b.id === blockId);
  if (!existing) throw new NotFoundError("Block not found in the draft");
  const ran = await runDraftBlock(context, content, {
    ...apiBlock,
    layout: apiBlock.layout ?? existing.layout,
  });
  const block = { ...ran, id: existing.id, uid: existing.uid };
  const draft = await editDashboardDraft(
    context,
    dashboardId,
    { op: "update-block", block },
    options,
  );
  return { draft, block };
}

export async function updateDashboardDraftSettings(
  context: ReqContext,
  dashboardId: string,
  settings: Partial<Omit<DashboardVersionContent, "blocks">>,
): Promise<DashboardVersionInterface> {
  let draft = await editDashboardDraft(context, dashboardId, {
    op: "set-settings",
    settings,
  });
  if (settings.globalControls === undefined) return draft;

  // New dashboard-wide controls change what a chart shows, so each one is run again.
  for (const block of draft.content.blocks) {
    if (!("explorerAnalysisId" in block)) continue;
    try {
      const apiBlock = apiCreateDashboardBlockInterface.parse(
        omit(toBlockApiInterface(block), [
          "id",
          "uid",
          "organization",
          "explorerAnalysisId",
          "comparisonExplorerAnalysisId",
        ]),
      );
      ({ draft } = await replaceDashboardDraftBlock(
        context,
        dashboardId,
        block.id,
        apiBlock,
        { silent: true },
      ));
    } catch (err) {
      // Best effort: the block keeps its previous result.
      logger.warn(
        { err, blockId: block.id },
        "Failed to re-run a draft block after its dashboard controls changed",
      );
    }
  }
  return draft;
}

export function toApiDashboardDraft(
  draft: DashboardVersionInterface,
): ApiDashboardDraft {
  return {
    dashboardId: draft.dashboardId,
    version: draft.version,
    title: draft.content.title,
    globalControls: draft.content.globalControls,
    blocks: draft.content.blocks.map(toBlockApiInterface),
    dateUpdated: draft.dateUpdated.toISOString(),
  };
}
