import { createHash } from "crypto";
import isEqual from "lodash/isEqual";
import omit from "lodash/omit";
import type {
  ExperimentInterface,
  ExperimentPhase,
  ApiConfirmation,
  ConfirmationInterface,
  ConfirmationNotice,
  ConfirmAction,
  ConfirmRule,
  ConfirmationLink,
} from "shared/validators";
import type { RevisionTargetType } from "shared/enterprise";
import type { FeatureInterface } from "shared/types/feature";
import {
  armedActions,
  capitalizeFirstCharacter,
  matchConfirmRules,
  scheduleActions,
  stringToBoolean,
} from "shared/util";
import { CONFIRM_OVERRIDE_FLAGS } from "shared/validators";
import type { ReqContext } from "back-end/types/request";
import type {
  BypassedGate,
  BypassVia,
  PublishGate,
  SkippedGate,
} from "back-end/src/revisions/publishGates";
import {
  BadRequestError,
  ConfirmationRequiredError,
} from "back-end/src/util/errors";
import { APP_ORIGIN, IS_MULTI_ORG } from "back-end/src/util/secrets";
import { PAYLOAD_AFFECTING_EXPERIMENT_FIELDS } from "back-end/src/services/experimentPayloadFields";

const TTL_MS = 60 * 60 * 1000;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const OVERRIDE_ACTIONS: Record<BypassVia, ConfirmAction | null> = {
  ignoreWarnings: "override.ignoreWarnings",
  skipSchemaValidation: "override.skipSchemaValidation",
  skipHooks: "override.skipHooks",
  bypassApprovalPermission: "override.bypassApproval",
  restApiBypassesReviews: "override.restBypassesReviews",
  revertsBypassApproval: null,
};

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const asRecord = (v: unknown) =>
  (v && typeof v === "object" ? v : {}) as Record<string, unknown>;

// Every key answers only to its own rules, so scripts and CI keep working.
// App sessions are never held.
function rulesFor(context: ReqContext): ConfirmRule[] {
  const key = context.apiKeyData;
  if (!context.isApiRequest || !key) return [];
  return key.confirmRules ?? [];
}

export const REVISION_MODEL = {
  feature: "feature",
  "saved-group": "savedGroup",
  constant: "constant",
  config: "config",
} as const satisfies Record<
  RevisionTargetType | "feature",
  ConfirmationLink["type"]
>;

// A ramp plan staged on a draft starts a schedule or edits one when it lands.
export const rampScheduleAction = (mode: string): ConfirmAction =>
  mode === "create" ? "rampSchedule.start" : "rampSchedule.edit";

// Where each kind of thing lives in the app; some only have a list page.
const LINK_PAGES: Record<ConfirmationLink["type"], (id: string) => string> = {
  feature: (id) => `features/${id}`,
  experiment: (id) => `experiment/${id}`,
  savedGroup: (id) => `saved-groups/${id}`,
  constant: (id) => `constants/${id}`,
  config: (id) => `configs/${id}`,
  environment: () => "environments",
  attribute: (id) => `attributes/${id}`,
  project: (id) => `project/${id}`,
  customHook: () => "settings/custom-hooks",
  customField: () => "settings/customfields",
  team: (id) => `settings/team/${id}`,
  sdkConnection: (id) => `sdks/${id}`,
  metric: (id) => `metric/${id}`,
  factMetric: (id) => `fact-metrics/${id}`,
  metricGroup: (id) => `metric-groups/${id}`,
  factTable: (id) => `fact-tables/${id}`,
  segment: () => "segments",
  dimension: () => "dimensions",
};

// Constants and configs are addressed by key, everything else by id.
export function confirmationLink(
  type: ConfirmationLink["type"],
  id: string,
  label = id,
): ConfirmationLink {
  return {
    type,
    label,
    url: `${APP_ORIGIN}/${LINK_PAGES[type](encodeURIComponent(id))}`,
  };
}

export function toApiConfirmation(c: ConfirmationInterface): ApiConfirmation {
  return {
    id: c.id,
    status:
      c.status === "pending" && c.expiresAt < new Date() ? "expired" : c.status,
    actions: c.actions,
    summary: c.summary,
    // With several orgs, the link opens in the one the request was made in.
    url: `${APP_ORIGIN}/confirmations/${c.id}${IS_MULTI_ORG ? `?org=${c.organization}` : ""}`,
    expiresAt: c.expiresAt.toISOString(),
    response: c.response,
    note: c.note,
  };
}

type HeldRequest = Pick<
  ConfirmationInterface,
  "method" | "path" | "query" | "body"
>;
type IncomingRequest = {
  method: string;
  originalUrl: string;
  query?: unknown;
  body?: unknown;
};

function heldRequest(req: IncomingRequest): HeldRequest {
  return JSON.parse(
    JSON.stringify({
      method: req.method,
      path: req.originalUrl.split("?")[0],
      query: req.query ?? {},
      body: req.body ?? {},
    }),
  );
}

// The same request without its skip flags, so a retry that adds them finds the
// refusal it is skipping past.
function attemptHash(request: HeldRequest) {
  const flags = Object.keys(CONFIRM_OVERRIDE_FLAGS);
  return hash([
    request.method,
    request.path,
    omit(asRecord(request.query), flags),
    omit(asRecord(request.body), flags),
  ]);
}

// Checks in their own words: ones a request skips, or ones that refused it.
export const gateNotices = (
  gates: (PublishGate | SkippedGate)[],
): ConfirmationNotice[] =>
  gates
    .filter((gate) => gate.messages.length)
    .map((gate) => ({
      severity: gate.severity === "blocker" ? "error" : "warning",
      messages: gate.messages,
      via: "via" in gate ? gate.via : null,
    }));

// Keeps what a refused write said, for keys that may retry it past the checks.
export async function recordRefusal(
  context: ReqContext,
  req: IncomingRequest,
  notices: ConfirmationNotice[],
) {
  if (!context.apiKey || !rulesFor(context).length || req.method === "GET") {
    return;
  }
  await context.models.confirmationAttempts.record(
    context.apiKey,
    attemptHash(heldRequest(req)),
    notices,
    new Date(Date.now() + TTL_MS),
  );
}

type ConfirmationDescription = { summary: string; links: ConfirmationLink[] };

// Call after a handler's checks and before its first write. Holds the request
// (202) when a rule matches; lets a confirmed replay through unchanged.
export async function requireConfirmation(
  context: ReqContext,
  opts: {
    actions: readonly ConfirmAction[];
    // Where the change applies; none matches every environment rule.
    environments?: string[];
    bypassing?: BypassedGate[];
    project?: string;
    // Anything that must not change between hold and run, e.g. a revision's dateUpdated.
    pin: unknown;
    // What the checks this request skips said.
    notices?: ConfirmationNotice[];
  } & (
    | ConfirmationDescription
    // Worked out only once something is held, when it costs a lookup.
    | { describe: () => Promise<ConfirmationDescription> }
  ),
): Promise<void> {
  const environments = opts.environments ?? [];
  const requested = [
    ...new Set([
      ...opts.actions,
      ...(opts.bypassing ?? []).flatMap(
        ({ via }) => OVERRIDE_ACTIONS[via] ?? [],
      ),
      ...requestedOverrides(context),
    ]),
  ].map((action) => ({ action, environments }));
  const held = matchConfirmRules(rulesFor(context), requested);
  if (!held.length) return;

  const { summary, links } = "describe" in opts ? await opts.describe() : opts;
  const fingerprint = hash([held, summary, opts.pin]);
  const confirmations = context.models.confirmations;
  if (context.confirmationId) {
    const id = context.confirmationId;
    const stored = await confirmations.getById(id);
    if (stored?.fingerprint === fingerprint) return;
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
  const request = heldRequest(req);
  // An org key naming a member holds per member, and replays as the same request.
  const auditUser = context.auditUser;
  const requestedBy =
    auditUser?.type === "api_key" ? (auditUser.requestedBy ?? null) : null;
  const assumedRole = auditUser?.type === "api_key" && !!auditUser.assumedRole;
  const requestHash = hash([
    request,
    fingerprint,
    requestedBy?.id,
    assumedRole,
  ]);
  // Without fresh check text, a retry that skips checks shows what they said
  // when the same request was refused.
  const skipping = held.some(({ action }) => action.startsWith("override."));
  const lastAttempt =
    !opts.notices?.length && skipping
      ? await context.models.confirmationAttempts.findLatest(
          context.apiKey,
          attemptHash(request),
        )
      : null;
  const now = Date.now();
  const confirmation =
    (await confirmations.findPending(context.apiKey, requestHash)) ??
    (await confirmations.create({
      userId: context.actingPerson?.id ?? null,
      requestedBy,
      assumedRole,
      apiKeyId: context.apiKey,
      project: opts.project || "",
      ...request,
      requestHash,
      actions: held,
      requested,
      summary,
      links,
      notices: lastAttempt?.notices ?? opts.notices ?? [],
      lastAttemptAt: lastAttempt?.dateUpdated ?? null,
      fingerprint,
      status: "pending",
      response: null,
      note: null,
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

// At least as loose as any handler reads a flag, so every skip it honors is held.
const asks = (v: unknown) =>
  v === true || (typeof v === "string" && stringToBoolean(v));

// Skip flags the request sends hold wherever it is checked, needed or not.
// Reads the replayed request on a confirmed run, so both see the same flags.
function requestedOverrides(context: ReqContext): ConfirmAction[] {
  const source = context.dispatchedRequest ?? context.req;
  const query = asRecord(source?.query);
  const body = asRecord(source?.body);
  return Object.entries(CONFIRM_OVERRIDE_FLAGS).flatMap(([flag, action]) =>
    asks(query[flag]) || asks(body[flag]) ? [action] : [],
  );
}

// The route-level hold: the endpoint's actions, with no environments, before the
// handler loads anything. Nothing has run, so replay is always safe.
type Named = { name?: string } | null;
// Routes by API tag: what they act on, its page, and how to find its name
// from the first id in the path.
const NAMED_ROUTES: Record<
  string,
  {
    noun: string;
    link: ConfirmationLink["type"];
    find?: (context: ReqContext, id: string) => Promise<Named>;
  }
> = {
  environments: { noun: "environment", link: "environment" },
  attributes: { noun: "attribute", link: "attribute" },
  projects: {
    noun: "project",
    link: "project",
    find: (context, id) => context.models.projects.getById(id),
  },
  "custom-hooks": {
    noun: "custom hook",
    link: "customHook",
    find: (context, id) => context.models.customHooks.getById(id),
  },
  CustomFields: {
    noun: "custom field",
    link: "customField",
    find: (context, id) =>
      context.models.customFields.getCustomFieldByFieldId(id),
  },
  Teams: {
    noun: "team",
    link: "team",
    find: (context, id) => context.models.teams.getById(id),
  },
  "sdk-connections": {
    noun: "SDK connection",
    link: "sdkConnection",
    find: async (context, id) =>
      (
        await import("back-end/src/models/SdkConnectionModel")
      ).findSDKConnectionById(context, id),
  },
  metrics: {
    noun: "metric",
    link: "metric",
    find: async (context, id) =>
      (await import("back-end/src/models/MetricModel")).getMetricById(
        context,
        id,
      ),
  },
  "fact-metrics": {
    noun: "fact metric",
    link: "factMetric",
    find: (context, id) => context.models.factMetrics.getById(id),
  },
  MetricGroups: {
    noun: "metric group",
    link: "metricGroup",
    find: (context, id) => context.models.metricGroups.getById(id),
  },
  "fact-tables": {
    noun: "fact table",
    link: "factTable",
    find: async (context, id) =>
      (await import("back-end/src/models/FactTableModel")).getFactTable(
        context,
        id,
      ),
  },
  segments: {
    noun: "segment",
    link: "segment",
    find: (context, id) => context.models.segments.getById(id),
  },
  dimensions: {
    noun: "dimension",
    link: "dimension",
    find: async (context, id) =>
      (await import("back-end/src/models/DimensionModel")).findDimensionById(
        id,
        context.org.id,
      ),
  },
};

// "Update project Checkout: name, description" for a plain route, naming the
// top-level fields it sets; null for any other route shape.
export function plainWriteSummary(
  method: string,
  path: string,
  noun: string,
  target: string,
  body: Record<string, unknown>,
): string | null {
  if (!/^\/[^/:]+(\/:\w+)?$/.test(path)) return null;
  const hasId = path.includes("/:");
  if (method === "delete") return `Delete ${noun} ${target}`.trim();
  if (!hasId) return `Create ${noun} ${target}`.trim();
  const fields = Object.keys(body)
    .filter((field) => !(field in CONFIRM_OVERRIDE_FLAGS))
    .map((field) => field.replace(/([A-Z])/g, " $1").toLowerCase());
  return `Update ${noun} ${target}${fields.length ? `: ${fields.join(", ")}` : ""}`;
}

async function describeRouteWrite(
  context: ReqContext,
  tags: readonly string[] | undefined,
  method: string,
  path: string,
  params: Record<string, string>,
  body: Record<string, unknown>,
): Promise<{ summary: string | null; links: ConfirmationLink[] }> {
  const named = tags?.map((tag) => NAMED_ROUTES[tag]).find(Boolean);
  if (!named) return { summary: null, links: [] };
  const id = Object.values(params)[0];
  const found = id ? await named.find?.(context, id).catch(() => null) : null;
  const target =
    found?.name ||
    id ||
    [body.name, body.id, body.property].find(
      (value): value is string => typeof value === "string",
    ) ||
    "";
  return {
    summary: plainWriteSummary(method, path, named.noun, target, body),
    links: id ? [confirmationLink(named.link, id, target)] : [],
  };
}

export async function holdAtRoute(
  context: ReqContext,
  actions: readonly ConfirmAction[],
  tags: readonly string[] | undefined,
  method: string,
  path: string,
  req: { params?: unknown; body?: unknown; query?: unknown },
  summary?: string,
): Promise<void> {
  const params = (req.params ?? {}) as Record<string, string>;
  const body = asRecord(req.body);
  await requireConfirmation(context, {
    actions: [
      ...actions.filter((action) => !action.startsWith("override.")),
      ...armedActions(tags, body),
    ],
    describe: async () => {
      const route = await describeRouteWrite(
        context,
        tags,
        method,
        path,
        params,
        body,
      );
      return {
        summary:
          route.summary ||
          summary ||
          `${method.toUpperCase()} ${path.replace(/:(\w+)/g, (_, k) => params[k] ?? k)}`,
        links: route.links,
      };
    },
    pin: null,
  });
}

// A direct flag update in words: "Archive my-flag", or
// "Update my-flag: turn on in staging, change the default value".
export function featureUpdateSummary(
  id: string,
  change: {
    archived?: boolean | null;
    envEnabled?: Record<string, boolean>;
    defaultValue?: boolean;
    rules?: boolean;
    metadata?: string[];
    prerequisites?: boolean;
    holdout?: boolean;
  },
): string {
  const archive =
    change.archived === true
      ? "archive"
      : change.archived === false
        ? "unarchive"
        : null;
  const parts = [
    ...Object.entries(change.envEnabled ?? {}).map(
      ([env, on]) => `turn ${on ? "on" : "off"} in ${env}`,
    ),
    change.defaultValue && "change the default value",
    change.rules && "change rules",
    !!change.metadata?.length && `change ${change.metadata.join(", ")}`,
    change.prerequisites && "change prerequisites",
    change.holdout && "change the holdout",
  ].filter((part): part is string => !!part);
  if (archive && !parts.length) {
    return `${capitalizeFirstCharacter(archive)} ${id}`;
  }
  return `Update ${id}: ${[archive, ...parts].filter(Boolean).join(", ")}`;
}

export function holdFeatureUpdate(
  context: ReqContext,
  feature: FeatureInterface,
  change: Parameters<typeof featureUpdateSummary>[1],
  bypassing: BypassedGate[],
  environments?: string[],
) {
  return requireConfirmation(context, {
    actions: [
      "feature.publish",
      ...(change.archived ? (["feature.archive"] as const) : []),
    ],
    environments,
    bypassing,
    project: feature.project,
    summary: featureUpdateSummary(feature.id, change),
    links: [confirmationLink("feature", feature.id)],
    pin: feature.dateUpdated,
  });
}

const PHASE_ACTIONS: [keyof ExperimentPhase, ConfirmAction][] = [
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
// Payload fields with no action of their own.
const OTHER_LIVE_FIELDS = PAYLOAD_AFFECTING_EXPERIMENT_FIELDS.filter(
  (field) =>
    field !== "phases" &&
    field !== "status" &&
    !(RERANDOMIZE_FIELDS as readonly string[]).includes(field),
);

// Omitted, null, "" and [] all mean "none", so echoing a field back isn't a change.
const normalize = (v: unknown) =>
  v === null || v === "" || (Array.isArray(v) && !v.length) ? undefined : v;
const differs = (before: unknown, after: unknown) =>
  !isEqual(normalize(before), normalize(after));
// An omitted top-level field is unchanged.
const changed = (before: unknown, after: unknown) =>
  after !== undefined && differs(before, after);

// What an update does to a live experiment, in the Make Changes flow's terms.
// Edits to a draft aren't live, so only starting it counts.
export function experimentChangeActions(
  existing: Omit<ExperimentInterface, "id" | "dateCreated" | "dateUpdated">,
  changes: Partial<ExperimentInterface>,
): ConfirmAction[] {
  const actions = new Set<ConfirmAction>();
  if (changes.status === "running" && existing.status !== "running") {
    actions.add("experiment.start");
  }
  if (changes.status === "stopped" && existing.status !== "stopped") {
    actions.add("experiment.stop");
  }
  const schedule = changes.statusUpdateSchedule;
  if (schedule && !isEqual(schedule, existing.statusUpdateSchedule)) {
    scheduleActions(schedule).forEach((action) => actions.add(action));
  }
  if (existing.status === "draft") return [...actions];

  if (RERANDOMIZE_FIELDS.some((f) => changed(existing[f], changes[f]))) {
    actions.add("experiment.phases");
  }
  const before = existing.phases ?? [];
  const after = changes.phases;
  if (after) {
    if (after.length !== before.length) actions.add("experiment.phases");
    before.forEach((phase, i) => {
      if (!after[i]) return;
      const isLatest = i === before.length - 1;
      for (const [field, action] of PHASE_ACTIONS) {
        // A replacement phase drops what it omits, so compare it as sent.
        if (differs(phase[field], after[i][field])) {
          actions.add(isLatest ? action : "experiment.phases");
        }
      }
    });
  }
  const live = existing as Partial<ExperimentInterface>;
  if (OTHER_LIVE_FIELDS.some((f) => changed(live[f], changes[f]))) {
    actions.add("experiment.other");
  }
  return [...actions];
}
