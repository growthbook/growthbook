import isEqual from "lodash/isEqual";
import pick from "lodash/pick";
import { z } from "zod";
import { getLatestPhaseVariations } from "shared/experiments";
import type { AuditInterfaceInput } from "shared/types/audit";
import { ExperimentInterface } from "shared/types/experiment";
import { URLRedirectInterface } from "shared/types/url-redirect";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { ExperimentChangesBody } from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { CasConflictError } from "back-end/src/models/BaseModel";
import { flushPayloadRefreshBuffer } from "back-end/src/revisions/landingSequence";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import {
  assertNoRedirectLoop,
  assertRedirectDestinations,
  assertRedirectOrigin,
  syncedDestinationURLs,
} from "back-end/src/models/UrlRedirectModel";
import {
  deleteVisualChangesetById,
  findVisualChangesetById,
  findVisualChangesetsByExperiment,
  updateVisualChangeset,
} from "back-end/src/models/VisualChangesetModel";
import {
  assertCanRunLinkedChanges,
  auditVisualChangeEditAfterStart,
} from "back-end/src/services/experiments";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { asJson, changedSinceLoaded, isoOrNull } from "./loadedBase";
import type { ExperimentUpdatePlan } from "./planExperimentUpdate";

type RedirectAdd = NonNullable<
  ExperimentChangesBody["addUrlRedirects"]
>[number];
type RedirectEdit = NonNullable<
  ExperimentChangesBody["editUrlRedirects"]
>[number];
type VisualEdit = NonNullable<
  ExperimentChangesBody["editVisualChangesets"]
>[number];

export type LinkedChangesPlan = {
  removeRedirects: URLRedirectInterface[];
  editRedirects: { loaded: URLRedirectInterface; edit: RedirectEdit }[];
  addRedirects: RedirectAdd[];
  editVisual: VisualEdit[];
  removeVisual: string[];
  // The variation sync rewrites every redirect's destinations before these land.
  variationsChange: boolean;
};

const REDIRECT_FIELDS = [
  "urlPattern",
  "destinationURLs",
  "persistQueryString",
] as const;

const redirectName = (redirect: { urlPattern: string }) =>
  `The URL Redirect from ${redirect.urlPattern}`;

const visualName = (changeset: VisualChangesetInterface) =>
  `The Visual Editor change for ${changeset.editorUrl}`;

function assertListedOnce(ids: string[], what: string) {
  if (new Set(ids).size !== ids.length) {
    throw new BadRequestError(`Each ${what} can appear only once.`);
  }
}

// Loose, like `experiment.base`: a legacy change can lack any of these.
const loadedVisualChanges = z.array(
  z
    .object({
      id: z.string(),
      css: z.unknown(),
      js: z.unknown(),
      domMutations: z.unknown(),
    })
    .passthrough(),
);

// As the page reads them: an absent css or js is empty.
const editableParts = (change: {
  css?: unknown;
  js?: unknown;
  domMutations?: unknown;
}) =>
  asJson({
    css: change.css ?? "",
    js: change.js ?? "",
    domMutations: change.domMutations ?? [],
  });

function assertVisualBaseMatches(
  current: VisualChangesetInterface,
  { changes, base }: VisualEdit,
) {
  for (const key of Object.keys(changes)) {
    if (!(key in base)) {
      throw new BadRequestError(`base is missing the loaded value of ${key}`);
    }
  }
  const moved = () => changedSinceLoaded(visualName(current));
  for (const key of ["editorUrl", "urlPatterns"] as const) {
    if (key in changes && !isEqual(asJson(current[key]), asJson(base[key]))) {
      throw moved();
    }
  }
  if (!changes.visualChanges) return;
  const loaded = loadedVisualChanges.safeParse(base.visualChanges);
  if (!loaded.success) {
    throw new BadRequestError(
      "base is missing the loaded value of visualChanges",
    );
  }
  for (const { id } of changes.visualChanges) {
    const was = loaded.data.find((c) => c.id === id);
    if (!was) {
      throw new BadRequestError(
        `base is missing the loaded value of visual change ${id}`,
      );
    }
    const now = current.visualChanges.find((c) => c.id === id);
    if (!now || !isEqual(editableParts(now), editableParts(was))) {
      throw moved();
    }
  }
}

// Every check, with no writes, judged against the variations the save leaves.
export async function planLinkedChanges(
  context: ReqContext,
  experiment: ExperimentInterface,
  experimentPlan: ExperimentUpdatePlan | null,
  body: ExperimentChangesBody,
): Promise<LinkedChangesPlan | null> {
  const adds = body.addUrlRedirects ?? [];
  const edits = body.editUrlRedirects ?? [];
  const removes = body.removeUrlRedirects ?? [];
  const visualEdits = body.editVisualChangesets ?? [];
  const visualRemoves = body.removeVisualChangesets ?? [];
  const touchesRedirects = !!(adds.length || edits.length || removes.length);
  const touchesVisual = !!(visualEdits.length || visualRemoves.length);
  if (!touchesRedirects && !touchesVisual) return null;

  if (experiment.type === "holdout") {
    throw new BadRequestError(
      "A holdout has no URL Redirects or Visual Editor changes.",
    );
  }
  if (experiment.archived) {
    throw new BadRequestError(
      "Unarchive the experiment to change its URL Redirects or Visual Editor changes.",
    );
  }
  assertListedOnce([...edits.map((e) => e.id), ...removes], "URL Redirect");
  assertListedOnce(
    [...visualEdits.map((e) => e.id), ...visualRemoves],
    "Visual Editor change",
  );

  const changes = experimentPlan?.changes ?? {};
  if (touchesRedirects) {
    if (experiment.status !== "draft" || experiment.nextScheduledStatusUpdate) {
      throw new BadRequestError(
        "URL Redirects can only change while the experiment is a draft with no scheduled start.",
      );
    }
    // The first redirect re-derives the type from what's linked.
    if (adds.length && changes.implementationType !== undefined) {
      throw new BadRequestError(
        "Change the implementation type or add a URL Redirect, not both in one save.",
      );
    }
  }
  assertCanRunLinkedChanges(
    context,
    experiment,
    "project" in changes ? [changes.project || undefined] : [],
  );

  const variationIds = getLatestPhaseVariations({
    ...experiment,
    ...changes,
  }).map((v) => v.id);
  const plan: LinkedChangesPlan = {
    removeRedirects: [],
    editRedirects: [],
    addRedirects: adds,
    editVisual: visualEdits,
    removeVisual: [],
    variationsChange: !!changes.variations,
  };

  if (touchesRedirects) {
    const stored = await context.models.urlRedirects.findByExperiment(
      experiment.id,
    );
    const byId = new Map(stored.map((r) => [r.id, r]));
    plan.removeRedirects = removes.flatMap((id) => byId.get(id) ?? []);
    plan.editRedirects = edits.map((edit) => {
      const loaded = byId.get(edit.id);
      if (!loaded || isoOrNull(loaded.dateUpdated) !== edit.dateUpdated) {
        throw changedSinceLoaded(redirectName(loaded ?? edit));
      }
      return { loaded, edit };
    });

    const staged = [...adds, ...edits];
    for (const redirect of staged) {
      assertRedirectOrigin(redirect);
      assertRedirectDestinations(redirect, variationIds, { exact: true });
    }
    if (staged.some((r) => r.checkCircularDependencies)) {
      const replaced = new Set([...edits.map((e) => e.id), ...removes]);
      // One org-wide load for the save. This experiment's own redirects count
      // too: a draft isn't served yet, but they all go live together.
      const served = await context.models.urlRedirects.getServedRedirects();
      const kept = [
        ...new Map([...served, ...stored].map((r) => [r.id, r])).values(),
      ].filter((r) => !replaced.has(r.id));
      for (const redirect of staged) {
        if (!redirect.checkCircularDependencies) continue;
        assertNoRedirectLoop(redirect, [
          ...kept,
          ...staged.filter((other) => other !== redirect),
        ]);
      }
    }
  }

  if (touchesVisual) {
    const stored = await findVisualChangesetsByExperiment(
      experiment.id,
      context.org.id,
    );
    const byId = new Map(stored.map((c) => [c.id, c]));
    plan.removeVisual = visualRemoves.filter((id) => byId.has(id));
    for (const edit of visualEdits) {
      const current = byId.get(edit.id);
      if (!current) throw changedSinceLoaded("A Visual Editor change");
      const staged = edit.changes.visualChanges ?? [];
      assertListedOnce(
        staged.map((c) => c.id),
        "visual change",
      );
      assertVisualBaseMatches(current, edit);
      for (const { id } of staged) {
        const change = current.visualChanges.find((c) => c.id === id);
        if (!change || !variationIds.includes(change.variation)) {
          throw new BadRequestError(
            `${visualName(current)} edits a variation this save removes. Discard that edit, or keep the variation.`,
          );
        }
      }
    }
  }

  // No plan-time read of an experiment may stand in for it once writes begin.
  context.foreignRefs.experiment.clear();
  return plan;
}

// After the experiment write and its variation sync, so each write judges, and
// flips hasURLRedirects / hasVisualChangesets on, the experiment as saved.
export async function writeLinkedChanges(args: {
  context: ReqContext;
  experimentId: string;
  plan: LinkedChangesPlan;
  audit: (data: AuditInterfaceInput) => Promise<void>;
}): Promise<void> {
  const { context } = args;
  // One deduped refresh; events aren't deferred, as none of these is rolled back.
  // Kept this narrow: a feature landing inside it would skip deferring its events.
  if (context.sdkPayloadRefreshBuffer) return writeEach(args);
  context.sdkPayloadRefreshBuffer = {
    keys: [],
    treatEmptyProjectAsGlobal: false,
  };
  try {
    await writeEach(args);
  } finally {
    flushPayloadRefreshBuffer(context, "experiment-linked-changes");
  }
}

async function writeEach({
  context,
  experimentId,
  plan,
  audit,
}: Parameters<typeof writeLinkedChanges>[0]): Promise<void> {
  const redirects = context.models.urlRedirects;
  // The redirect model reads the experiment from this cache, and each write moves it.
  const evict = () => context.foreignRefs.experiment.delete(experimentId);
  const read = async () => {
    const experiment = await getExperimentById(context, experimentId);
    if (!experiment) throw new NotFoundError("Experiment not found");
    return experiment;
  };

  // Visual Editor writes first: the extension can write at any moment, so their
  // re-check is the likeliest to fail, and none depends on the redirects.
  for (const edit of plan.editVisual) {
    const current = await findVisualChangesetById(edit.id, context.org.id);
    if (!current || current.experiment !== experimentId) {
      throw changedSinceLoaded("A Visual Editor change");
    }
    // The Visual Editor may have written since the plan.
    assertVisualBaseMatches(current, edit);
    const staged = new Map(
      (edit.changes.visualChanges ?? []).map((c) => [c.id, c]),
    );
    const experiment = await read();
    await updateVisualChangeset({
      visualChangeset: current,
      experiment,
      context,
      updates: {
        ...pick(edit.changes, ["editorUrl", "urlPatterns"]),
        ...(edit.changes.visualChanges && {
          visualChanges: current.visualChanges.map((c) => ({
            ...c,
            ...staged.get(c.id),
          })),
        }),
      },
    });
    if (experiment.status !== "draft") {
      await auditVisualChangeEditAfterStart(audit, experiment, current.id);
    }
  }
  for (const id of plan.removeVisual) {
    const current = await findVisualChangesetById(id, context.org.id);
    if (!current || current.experiment !== experimentId) continue;
    const experiment = await read();
    await deleteVisualChangesetById({
      visualChangeset: current,
      experiment,
      context,
    });
    if (experiment.status !== "draft") {
      await auditVisualChangeEditAfterStart(audit, experiment, id);
    }
  }

  // Removes first: the plan judged the rest against what the save keeps.
  for (const { id } of plan.removeRedirects) {
    evict();
    await redirects.deleteById(id);
  }
  const variations =
    plan.variationsChange && plan.editRedirects.length
      ? (await read()).variations
      : null;
  for (const { loaded, edit } of plan.editRedirects) {
    evict();
    let guard = loaded;
    // The sync rewrote its destinations since the plan; any other move is an edit.
    if (variations) {
      const current = await redirects.getById(edit.id);
      const synced = {
        ...pick(loaded, REDIRECT_FIELDS),
        destinationURLs: syncedDestinationURLs(
          loaded.destinationURLs,
          variations,
        ),
      };
      if (
        !current ||
        !isEqual(asJson(pick(current, REDIRECT_FIELDS)), asJson(synced))
      ) {
        throw changedSinceLoaded(redirectName(loaded));
      }
      guard = current;
    }
    try {
      await redirects.updateIfUnchanged(guard, pick(edit, REDIRECT_FIELDS));
    } catch (e) {
      if (e instanceof CasConflictError) {
        throw changedSinceLoaded(redirectName(loaded));
      }
      throw e;
    }
  }
  for (const add of plan.addRedirects) {
    evict();
    await redirects.create({
      ...pick(add, REDIRECT_FIELDS),
      experiment: experimentId,
    });
  }
}
