import { createHash } from "crypto";
import isEqual from "lodash/isEqual";
import type {
  ExperimentInterface,
  ExperimentPhase,
  ApiConfirmation,
  ConfirmAction,
  ConfirmationInterface,
  ConfirmLabel,
  ConfirmRule,
  ConfirmationLink,
} from "shared/validators";
import type { RevisionTargetType } from "shared/enterprise";
import { matchConfirmRules } from "shared/util";
import { CONFIRM_OVERRIDE_FLAGS } from "shared/validators";
import type { ReqContext } from "back-end/types/request";
import type {
  BypassedGate,
  BypassVia,
} from "back-end/src/revisions/publishGates";
import {
  BadRequestError,
  ConfirmationRequiredError,
} from "back-end/src/util/errors";
import { APP_ORIGIN } from "back-end/src/util/secrets";

const TTL_MS = 60 * 60 * 1000;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const OVERRIDE_LABELS: Record<BypassVia, ConfirmLabel | null> = {
  ignoreWarnings: "override.ignoreWarnings",
  skipSchemaValidation: "override.skipSchemaValidation",
  skipHooks: "override.skipHooks",
  bypassApprovalPermission: "override.bypassApproval",
  restApiBypassesReviews: "override.restBypassesReviews",
  revertsBypassApproval: null,
};

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

// A person-bound token answers to the org's rules plus its own; an org key only
// to its own, so CI keys keep working. App sessions are never held.
function rulesFor(context: ReqContext): ConfirmRule[] {
  const key = context.apiKeyData;
  if (!context.isApiRequest || !key) return [];
  const own = key.confirmRules ?? [];
  return key.userId
    ? [...(context.org.settings?.confirmRules ?? []), ...own]
    : own;
}

export const REVISION_PUBLISH_LABEL: Record<RevisionTargetType, ConfirmLabel> =
  {
    "saved-group": "savedGroup.publish",
    constant: "constant.publish",
    config: "config.publish",
  };

const LINK_PATHS: Record<ConfirmationLink["type"], string> = {
  feature: "features",
  experiment: "experiment",
  savedGroup: "saved-groups",
  constant: "constants",
  config: "configs",
};

// Constants and configs are addressed by key, everything else by id.
export function confirmationLink(
  type: ConfirmationLink["type"],
  id: string,
  label = id,
): ConfirmationLink {
  return { type, label, url: `${APP_ORIGIN}/${LINK_PATHS[type]}/${id}` };
}

// Whether a person would have to confirm these, e.g. to skip work that can't be held.
export function wouldHold(context: ReqContext, labels: ConfirmLabel[]) {
  return (
    !context.confirmationId &&
    matchConfirmRules(
      rulesFor(context),
      labels.map((action) => ({ action, environments: [] })),
    ).length > 0
  );
}

export function toApiConfirmation(c: ConfirmationInterface): ApiConfirmation {
  return {
    id: c.id,
    status:
      c.status === "pending" && c.expiresAt < new Date() ? "expired" : c.status,
    actions: c.actions,
    summary: c.summary,
    url: `${APP_ORIGIN}/confirmations/${c.id}`,
    expiresAt: c.expiresAt.toISOString(),
    response: c.response,
    rejectionNote: c.rejectionNote,
  };
}

// Call after a handler's checks and before its first write. Holds the request
// (202) when a rule matches; lets a confirmed replay through unchanged.
export async function requireConfirmation(
  context: ReqContext,
  opts: {
    actions: ConfirmAction[];
    bypassing?: BypassedGate[];
    project: string;
    summary: string;
    links: ConfirmationLink[];
    // Anything that must not change between hold and run, e.g. a revision's dateUpdated.
    pin: unknown;
  },
): Promise<void> {
  const environments = opts.actions.flatMap((a) => a.environments);
  const overrides = (opts.bypassing ?? []).flatMap(({ via }) => {
    const action = OVERRIDE_LABELS[via];
    return action ? [{ action, environments }] : [];
  });
  const actions = matchConfirmRules(rulesFor(context), [
    ...opts.actions,
    ...overrides,
  ]);
  if (!actions.length) return;

  const fingerprint = hash([actions, opts.summary, opts.pin]);
  const confirmations = context.models.confirmations;
  if (context.confirmationId) {
    const id = context.confirmationId;
    const held = await confirmations.getById(id);
    if (held?.fingerprint === fingerprint) return;
    await confirmations.updateWithCas(id, ["status"], (doc) =>
      doc.status === "running" ? { status: "expired" } : null,
    );
    throw new BadRequestError(
      "This request changed after it was confirmed, so it was not run. Send it again for a new confirmation.",
    );
  }

  const req = context.req;
  if (!req || !context.apiKey) {
    throw new BadRequestError(
      "This action needs a person's confirmation, which only a direct API request can ask for.",
    );
  }
  const request = JSON.parse(
    JSON.stringify({
      method: req.method,
      path: req.originalUrl.split("?")[0],
      query: req.query ?? {},
      body: req.body ?? {},
    }),
  );
  const requestHash = hash([request, fingerprint]);
  const now = Date.now();
  const confirmation =
    (await confirmations.findPending(context.apiKey, requestHash)) ??
    (await confirmations.create({
      userId: context.apiKeyData?.userId ?? null,
      apiKeyId: context.apiKey,
      project: opts.project,
      ...request,
      requestHash,
      actions,
      summary: opts.summary,
      links: opts.links,
      fingerprint,
      status: "pending",
      response: null,
      rejectionNote: null,
      decidedBy: null,
      decidedAt: null,
      expiresAt: new Date(now + TTL_MS),
      deleteAt: new Date(now + TTL_MS + RETENTION_MS),
    }));

  throw new ConfirmationRequiredError(
    {
      confirmation: toApiConfirmation(confirmation),
      message:
        "A person must confirm this in GrowthBook. Give them the url, then poll the Location.",
    },
    {
      Location: `/api/v1/confirmations/${confirmation.id}`,
      "Retry-After": "5",
    },
  );
}

const asRecord = (v: unknown) =>
  (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
// Query flags arrive as strings unless the route's schema parsed them.
const isTrue = (v: unknown) => v === true || v === "true" || v === "1";

// The route-level hold: the endpoint's labels, with no environments, before the
// handler loads anything. Nothing has run, so replay is always safe.
export async function holdAtRoute(
  context: ReqContext,
  labels: readonly ConfirmLabel[],
  method: string,
  path: string,
  req: { params?: unknown; body?: unknown; query?: unknown },
  summary?: string,
): Promise<void> {
  const params = (req.params ?? {}) as Record<string, string>;
  const fields = { ...asRecord(req.query), ...asRecord(req.body) };
  const requested = Object.entries(CONFIRM_OVERRIDE_FLAGS).flatMap(
    ([flag, label]) => (isTrue(fields[flag]) ? [label] : []),
  );
  const actions = [
    ...labels.filter((label) => !label.startsWith("override.")),
    ...requested,
  ].map((action) => ({ action, environments: [] }));
  await requireConfirmation(context, {
    actions,
    project: "",
    summary:
      summary ||
      `${method.toUpperCase()} ${path.replace(/:(\w+)/g, (_, k) => params[k] ?? k)}`,
    links: [],
    pin: null,
  });
}

// A direct flag update in words: "Archive my-flag", or
// "Update my-flag: turn on in staging, change the default value".
export function featureUpdateSummary(
  id: string,
  change: {
    archived: boolean | null;
    envEnabled: Record<string, boolean>;
    defaultValue: boolean;
    rules: boolean;
    metadata: string[];
    prerequisites: boolean;
    holdout: boolean;
  },
): string {
  const archive =
    change.archived === null ? null : change.archived ? "archive" : "unarchive";
  const parts = [
    ...Object.entries(change.envEnabled).map(
      ([env, on]) => `turn ${on ? "on" : "off"} in ${env}`,
    ),
    change.defaultValue && "change the default value",
    change.rules && "change rules",
    change.metadata.length > 0 && `change ${change.metadata.join(", ")}`,
    change.prerequisites && "change prerequisites",
    change.holdout && "change the holdout",
  ].filter((part): part is string => !!part);
  if (archive && !parts.length) {
    return `${archive[0].toUpperCase()}${archive.slice(1)} ${id}`;
  }
  return `Update ${id}: ${[archive, ...parts].filter(Boolean).join(", ")}`;
}

const PHASE_LABELS: [keyof ExperimentPhase, ConfirmLabel][] = [
  ["condition", "experiment.targeting"],
  ["savedGroups", "experiment.targeting"],
  ["prerequisites", "experiment.targeting"],
  ["coverage", "experiment.traffic"],
  ["variationWeights", "experiment.traffic"],
  ["namespace", "experiment.traffic"],
  ["seed", "experiment.phases"],
  ["name", "experiment.phases"],
  ["reason", "experiment.phases"],
  ["dateStarted", "experiment.phases"],
  ["dateEnded", "experiment.phases"],
  ["lookbackStartDate", "experiment.phases"],
];
const RERANDOMIZE_FIELDS = [
  "hashAttribute",
  "fallbackAttribute",
  "hashVersion",
  "disableStickyBucketing",
  "bucketVersion",
  "minBucketVersion",
] as const;

// Omitted, null, "" and [] all mean "none", so echoing a field back isn't a change.
const normalize = (v: unknown) =>
  v === null || v === "" || (Array.isArray(v) && !v.length) ? undefined : v;
const changed = (before: unknown, after: unknown) =>
  after !== undefined && !isEqual(normalize(before), normalize(after));

// What an update does to a live experiment, in the Make Changes flow's terms.
// Edits to a draft aren't live, so only starting it counts.
export function experimentChangeLabels(
  existing: Omit<ExperimentInterface, "id" | "dateCreated" | "dateUpdated">,
  changes: Partial<ExperimentInterface>,
): ConfirmLabel[] {
  const labels = new Set<ConfirmLabel>();
  if (changes.status === "running" && existing.status !== "running") {
    labels.add("experiment.start");
  }
  if (changes.status === "stopped" && existing.status !== "stopped") {
    labels.add("experiment.stop");
  }
  // A scheduled start or stop happens later with no one present.
  const schedule = changes.statusUpdateSchedule;
  if (schedule && !isEqual(schedule, existing.statusUpdateSchedule)) {
    if (schedule.startAt) labels.add("experiment.start");
    if (schedule.stopAt || schedule.stopAfter) labels.add("experiment.stop");
  }
  if (existing.status === "draft") return [...labels];

  if (RERANDOMIZE_FIELDS.some((f) => changed(existing[f], changes[f]))) {
    labels.add("experiment.phases");
  }
  const before = existing.phases ?? [];
  const after = changes.phases;
  if (after) {
    if (after.length !== before.length) labels.add("experiment.phases");
    before.forEach((phase, i) => {
      if (!after[i]) return;
      const isLatest = i === before.length - 1;
      for (const [field, label] of PHASE_LABELS) {
        if (changed(phase[field], after[i][field])) {
          labels.add(isLatest ? label : "experiment.phases");
        }
      }
    });
  }
  return [...labels];
}
