import { createHash } from "crypto";
import isEqual from "lodash/isEqual";
import omit from "lodash/omit";
import type {
  ContextualBanditInterface,
  InterleavingInterface,
  ExperimentInterface,
  ExperimentPhase,
  ApiConfirmation,
  ConfirmationInterface,
  ConfirmationNotice,
  ConfirmAction,
  ConfirmRule,
  ConfirmationLink,
} from "shared/validators";
import type { HttpVerb } from "shared/api-spec";
import type { RevisionTargetType } from "shared/enterprise";
import type { FeatureInterface } from "shared/types/feature";
import type { FeatureRevisionInterface } from "shared/types/feature-revision";
import {
  armedActions,
  capitalizeFirstCharacter,
  hasPendingScheduledStart,
  matchConfirmRules,
  proposedArchivedValue,
  routeConfirmation,
  scheduleActions,
  stringToBoolean,
} from "shared/util";
import {
  CONFIRM_OVERRIDE_FLAGS,
  BYPASS_OVERRIDE_ACTIONS,
  FEATURE_LANDING_ACTIONS,
} from "shared/validators";
import type { ReqContext } from "back-end/types/request";
import type {
  BypassedGate,
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

// The ramp plans staged on a flag draft: each starts a schedule or edits one when
// the draft lands.
export const rampPlanActions = (
  revision: Pick<FeatureRevisionInterface, "rampActions">,
): ConfirmAction[] =>
  (revision.rampActions ?? []).map(({ mode }) =>
    mode === "create" ? "rampSchedule.start" : "rampSchedule.edit",
  );

// Where each kind of thing lives in the app; some only have a list page.
const LINK_PAGES: Record<ConfirmationLink["type"], (id: string) => string> = {
  feature: (id) => `features/${id}`,
  experiment: (id) => `experiment/${id}`,
  contextualBandit: (id) => `contextual-bandit/${id}`,
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

// Well past the longest confirmed run (an AI edit's model calls), so one still
// going this long after it was confirmed was cut off, e.g. by a restart.
const RUN_CUT_OFF_MS = 30 * 60 * 1000;

export function toApiConfirmation(c: ConfirmationInterface): ApiConfirmation {
  const cutOff =
    c.status === "running" &&
    (c.decidedAt?.getTime() ?? 0) < Date.now() - RUN_CUT_OFF_MS;
  return {
    id: c.id,
    status: cutOff
      ? "completed"
      : c.status === "pending" && c.expiresAt < new Date()
        ? "expired"
        : c.status,
    actions: c.actions,
    summary: c.summary,
    // With several orgs, the link opens in the one the request was made in.
    url: `${APP_ORIGIN}/confirmations/${c.id}${IS_MULTI_ORG ? `?org=${c.organization}` : ""}`,
    expiresAt: c.expiresAt.toISOString(),
    response: cutOff
      ? {
          status: 500,
          body: {
            message:
              "This request was cut off before it finished. Check whether it took effect, then send it again.",
          },
        }
      : c.response,
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
      // Express also routes a trailing slash, which the replay's router doesn't.
      path: req.originalUrl.split("?")[0].replace(/(.)\/+$/, "$1"),
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
    summary: string;
    links: ConfirmationLink[];
    // Anything that must not change between hold and run, e.g. a revision's dateUpdated.
    pin: unknown;
    // What the checks this request skips said.
    notices?: ConfirmationNotice[];
  },
): Promise<void> {
  const environments = opts.environments ?? [];
  const requested = [
    ...new Set([
      ...opts.actions,
      ...(opts.bypassing ?? []).flatMap(
        ({ via }) => BYPASS_OVERRIDE_ACTIONS[via] ?? [],
      ),
      ...(context.org.settings?.restApiBypassesReviews &&
      opts.actions.some((action) => REVIEWED_WRITES.has(action))
        ? (["override.restBypassesReviews"] as const)
        : []),
      ...requestedOverrides(context),
    ]),
  ].map((action) => ({ action, environments }));
  const held = matchConfirmRules(rulesFor(context), requested);
  if (!held.length) return;

  const fingerprint = hash([held, opts.summary, opts.pin]);
  const confirmations = context.models.confirmations;
  if (context.confirmationId) {
    const id = context.confirmationId;
    const stored = await confirmations.getById(id);
    if (stored?.fingerprint === fingerprint) return;
    const message =
      "This request changed after it was confirmed, so it was not run. Send it again for a new confirmation.";
    await confirmations.updateWithCas(id, ["status"], (doc) =>
      doc.status === "running"
        ? { status: "expired", response: { status: 400, body: { message } } }
        : null,
    );
    throw new BadRequestError(message);
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
      oauthClientId: context.apiKeyData?.oauthClientId,
      project: opts.project || "",
      ...request,
      requestHash,
      actions: held,
      summary: opts.summary,
      links: opts.links,
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

export function overridesIn(
  request: { query?: unknown; body?: unknown } | undefined,
): ConfirmAction[] {
  const query = asRecord(request?.query);
  const body = asRecord(request?.body);
  return Object.entries(CONFIRM_OVERRIDE_FLAGS).flatMap(([flag, action]) =>
    asks(query[flag]) || asks(body[flag]) ? [action] : [],
  );
}

// Skip flags the request sends hold wherever it is checked, needed or not.
// Reads the replayed request on a confirmed run, so both see the same flags.
function requestedOverrides(context: ReqContext): ConfirmAction[] {
  return overridesIn(context.dispatchedRequest ?? context.req);
}

// Routes by API tag: what they act on, its page, and how to find its name
// from the first id in the path.
const NAMED_ROUTES: Record<
  string,
  {
    noun: string;
    link: ConfirmationLink["type"];
    find?: (
      context: ReqContext,
      id: string,
    ) => Promise<{ name?: string } | null>;
  }
> = {
  environments: { noun: "environment", link: "environment" },
  attributes: { noun: "attribute", link: "attribute" },
  projects: {
    noun: "Project",
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
    noun: "SDK Connection",
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
    noun: "Fact Metric",
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

// Whether a draft is armed to publish later unattended, and what landing it does.
type DraftState = { armed: boolean; lands: ConfirmAction[] } | null;
type ArmableRevision = {
  autoPublishOnApproval?: boolean;
  scheduledPublishAt?: Date | null;
};
const isArmed = (revision: ArmableRevision) =>
  !!revision.autoPublishOnApproval || !!revision.scheduledPublishAt;
const patchDraftState = (
  model: "savedGroup" | "constant" | "config",
  revision: (ArmableRevision & { target: { proposedChanges: unknown } }) | null,
): DraftState =>
  revision && {
    armed: isArmed(revision),
    lands: landingActions(
      model,
      proposedArchivedValue(revision.target.proposedChanges) === true,
    ),
  };

// Draft routes by API tag: how to load the revision they write to.
const DRAFT_REVISIONS: Record<
  string,
  {
    model: "feature" | "savedGroup" | "constant" | "config";
    load: (
      context: ReqContext,
      params: Record<string, string>,
    ) => Promise<DraftState>;
  }
> = {
  "feature-revisions": { model: "feature", load: loadFeatureRevision },
  "feature-revisions-v2": { model: "feature", load: loadFeatureRevision },
  "saved-group-revisions": {
    model: "savedGroup",
    load: async (context, { savedGroupId, version }) =>
      patchDraftState(
        "savedGroup",
        await context.models.revisions.getByTargetAndVersion(
          "saved-group",
          savedGroupId,
          Number(version),
        ),
      ),
  },
  "constant-revisions": {
    model: "constant",
    load: loadKeyedRevision("constant"),
  },
  "config-revisions": { model: "config", load: loadKeyedRevision("config") },
};

// Constants and configs are routed by key, but their revisions by id.
function loadKeyedRevision(type: "constant" | "config") {
  return async (
    context: ReqContext,
    { key, version }: Record<string, string>,
  ): Promise<DraftState> => {
    const entity = await (
      type === "constant" ? context.models.constants : context.models.configs
    ).getByKey(key);
    return entity
      ? patchDraftState(
          type,
          await context.models.revisions.getByTargetAndVersion(
            type,
            entity.id,
            Number(version),
          ),
        )
      : null;
  };
}

async function loadFeatureRevision(
  context: ReqContext,
  { id, version }: Record<string, string>,
): Promise<DraftState> {
  const { getRevision } = await import(
    "back-end/src/models/FeatureRevisionModel"
  );
  const revision = await getRevision({
    context,
    organization: context.org.id,
    featureId: id,
    feature: undefined,
    version: Number(version),
  });
  return revision && featureDraftState(revision);
}

// Arming a draft to publish later holds as what landing it does. An edit to an
// armed draft can add anything a landing does, so it holds as all of that.
async function armedRevisionActions(
  context: ReqContext,
  tags: readonly string[] | undefined,
  actions: readonly ConfirmAction[],
  params: Record<string, string>,
  body: Record<string, unknown>,
): Promise<ConfirmAction[]> {
  const draft = tags?.map((tag) => DRAFT_REVISIONS[tag]).find(Boolean);
  // "new" asks for a fresh draft, which nothing has armed yet.
  if (!draft || !params.version || params.version === "new") return [];
  const editing = actions.includes(`${draft.model}.draft`);
  const arming = armedActions(tags, body).length > 0;
  if (!editing && !arming) return [];
  const state = await draft.load(context, params);
  if (editing) return arming || state?.armed ? everyLanding(draft.model) : [];
  return state?.lands ?? landingActions(draft.model, false);
}

// Publishing a draft: the publish, plus any archive or ramp plan it carries.
export const landingActions = (
  model: "feature" | "savedGroup" | "constant" | "config",
  archives: boolean,
  ramps: ConfirmAction[] = [],
): ConfirmAction[] => [
  `${model}.publish`,
  ...(archives ? ([`${model}.archive`] as const) : []),
  ...ramps,
];
const featureLanding = (revision: FeatureRevisionInterface) =>
  landingActions(
    "feature",
    revision.archived === true,
    rampPlanActions(revision),
  );
const featureDraftState = (revision: FeatureRevisionInterface): DraftState => ({
  armed: isArmed(revision),
  lands: featureLanding(revision),
});
// With REST bypassing reviews org-wide, any key's publish or archive of something
// reviewed may be skipping a review.
const REVIEWED_WRITES = new Set(
  Object.values(REVISION_MODEL).flatMap((model) => landingActions(model, true)),
);

// The backstop for any path that edits an armed draft without classifying it: an
// unconfirmed edit by a key whose rules would hold that draft's landing disarms
// it, so nothing it changed publishes without a person. Only a direct request
// does; an armed publish firing never does.
function editDisarms(context: ReqContext, state: DraftState): boolean {
  if (!state?.armed || !context.req || context.confirmationId) return false;
  const held = state.lands.map((action) => ({ action, environments: [] }));
  return matchConfirmRules(rulesFor(context), held).length > 0;
}
export const editDisarmsFeatureDraft = (
  context: ReqContext,
  revision: FeatureRevisionInterface,
) => editDisarms(context, featureDraftState(revision));
export const editDisarmsDraft = (
  context: ReqContext,
  model: "savedGroup" | "constant" | "config",
  revision: ArmableRevision & { target: { proposedChanges: unknown } },
) => editDisarms(context, patchDraftState(model, revision));
export const DISARMED_BY_EDIT =
  "Canceled because an API key whose publishes need a person's confirmation edited the draft";

// Everything landing a draft can do, for an edit that may add any of it.
const everyLanding = (
  model: "feature" | "savedGroup" | "constant" | "config",
): ConfirmAction[] =>
  model === "feature"
    ? [...FEATURE_LANDING_ACTIONS]
    : landingActions(model, true);

// A write into a flag draft: publishing it now lands it as it is (live, with no
// draft), and staging into it is draft work, plus all a landing can do when the
// draft is armed to publish later.
export async function featureDraftActions(
  context: ReqContext,
  featureId: string,
  version: number | string | undefined,
  publishNow: boolean,
): Promise<ConfirmAction[]> {
  const state =
    version === undefined
      ? null
      : await loadFeatureRevision(context, {
          id: featureId,
          version: String(version),
        });
  if (publishNow) return state?.lands ?? ["feature.publish"];
  return ["feature.draft", ...(state?.armed ? everyLanding("feature") : [])];
}

// The route-level hold: the endpoint's actions, with no environments, before the
// handler loads anything. Nothing has run, so replay is always safe.
export async function holdAtRoute(
  context: ReqContext,
  actions: readonly ConfirmAction[],
  tags: readonly string[] | undefined,
  method: string,
  path: string,
  req: { params?: unknown; body?: unknown; query?: unknown },
  summary?: string,
): Promise<void> {
  // Nothing below can hold without rules, and it costs lookups.
  if (!rulesFor(context).length) return;
  const params = (req.params ?? {}) as Record<string, string>;
  const body = asRecord(req.body);
  const route = await describeRouteWrite(
    context,
    tags,
    method,
    path,
    params,
    body,
  );
  await requireConfirmation(context, {
    actions: [
      ...actions.filter((action) => !action.startsWith("override.")),
      ...armedActions(tags, body),
      ...(await armedRevisionActions(context, tags, actions, params, body)),
    ],
    summary:
      route.summary ||
      summary ||
      `${method.toUpperCase()} ${path.replace(/:(\w+)/g, (_, k) => params[k] ?? k)}`,
    links: route.links,
    pin: null,
  });
}

export type HeldRoute = {
  confirmation: readonly ConfirmAction[];
  tags: readonly string[];
  method: HttpVerb;
  path: string;
  summary: string;
};

// The route-level hold, for a handler that checks the request first.
export const holdRoute = (
  context: ReqContext,
  route: HeldRoute,
  req: { params?: unknown; body?: unknown; query?: unknown },
) =>
  holdAtRoute(
    context,
    routeConfirmation(route.method, route.tags, route.confirmation),
    route.tags,
    route.method,
    route.path,
    req,
    route.summary,
  );

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

// A new flag is live wherever it starts enabled, so creating it there holds as a
// publish too.
export function holdFeatureCreate(
  context: ReqContext,
  feature: FeatureInterface,
  environments: string[],
) {
  return requireConfirmation(context, {
    actions: [
      "feature.create",
      ...(environments.length ? (["feature.publish"] as const) : []),
    ],
    environments,
    project: feature.project,
    summary: `Create ${feature.id}`,
    links: [],
    pin: null,
  });
}

export function holdFeatureUpdate(
  context: ReqContext,
  feature: FeatureInterface,
  change: Parameters<typeof featureUpdateSummary>[1],
  bypassing: BypassedGate[],
  environments?: string[],
) {
  return requireConfirmation(context, {
    actions: landingActions("feature", !!change.archived),
    environments,
    bypassing,
    project: feature.project,
    summary: featureUpdateSummary(feature.id, change),
    links: [confirmationLink("feature", feature.id)],
    pin: feature.dateUpdated,
  });
}

// What changing each phase field of a live experiment holds as, or null when it
// never reaches users. Typed over every field, so a new one won't compile until
// it's placed; when unsure, pick an action rather than null.
const PHASE_FIELD_ACTIONS: Record<keyof ExperimentPhase, ConfirmAction | null> =
  {
    condition: "experiment.targeting",
    savedGroups: "experiment.targeting",
    prerequisites: "experiment.targeting",
    coverage: "experiment.traffic",
    variationWeights: "experiment.traffic",
    namespace: "experiment.traffic",
    variations: "experiment.traffic",
    seed: "experiment.phases",
    name: "experiment.phases",
    reason: "experiment.phases",
    dateStarted: "experiment.phases",
    dateEnded: "experiment.phases",
    lookbackStartDate: "experiment.phases",
    // A log of past reweights; the weights themselves are variationWeights.
    banditEvents: null,
  };
const PHASE_ACTIONS = Object.entries(PHASE_FIELD_ACTIONS).flatMap(
  ([field, action]) =>
    action ? [[field as keyof ExperimentPhase, action] as const] : [],
);
const RERANDOMIZE_FIELDS = [
  // The seed when a phase has none of its own, as bandits treat it.
  "trackingKey",
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

// Starting an experiment or bandit publishes the feature drafts queued on it, so
// the start holds as their publish too, pinned to how they look now.
export async function queuedDraftsHold(
  context: ReqContext,
  queued: { featureId: string; revisionVersion: number }[] | undefined,
): Promise<{
  actions: ConfirmAction[];
  links: ConfirmationLink[];
  pin: unknown[];
}> {
  if (!queued?.length) return { actions: [], links: [], pin: [] };
  const { getRevision } = await import(
    "back-end/src/models/FeatureRevisionModel"
  );
  const revisions = await Promise.all(
    queued.map(({ featureId, revisionVersion }) =>
      getRevision({
        context,
        organization: context.org.id,
        featureId,
        feature: undefined,
        version: revisionVersion,
      }),
    ),
  );
  const pin = queued.map(({ featureId, revisionVersion }, i) => [
    featureId,
    revisionVersion,
    revisions[i]?.dateUpdated ?? null,
  ]);
  // Each publishes whole, with any archive or ramp plan it carries.
  return {
    actions: [
      ...new Set([
        "feature.publish" as const,
        ...revisions.flatMap((r) => (r ? featureLanding(r) : [])),
      ]),
    ],
    links: [...new Set(queued.map(({ featureId }) => featureId))].map((id) =>
      confirmationLink("feature", id),
    ),
    pin,
  };
}

// The stored values a change replaces, pinned so a confirmed change can't
// overwrite a newer edit to the same fields.
export const pinnedFields = (existing: object, changes: object) =>
  Object.keys(changes).map((field) => [
    field,
    (existing as Record<string, unknown>)[field],
  ]);

// Going live starts it; back to draft takes it out of the payload, like stopping.
const statusActions = (
  from: string,
  to: string | undefined,
): ConfirmAction[] => [
  ...(to === "running" && from !== "running"
    ? (["experiment.start"] as const)
    : []),
  ...((to === "stopped" && from !== "stopped") ||
  (to === "draft" && from !== "draft")
    ? (["experiment.stop"] as const)
    : []),
];

// Unarchiving puts a live experiment back in the payload, and gives a draft back
// the start armed before it was archived, which publishes its flags' drafts.
export function unarchiveActions(
  experiment: Pick<ExperimentInterface, "status" | "nextScheduledStatusUpdate">,
): ConfirmAction[] {
  if (experiment.status !== "draft") return ["experiment.start"];
  return hasPendingScheduledStart(experiment)
    ? ["experiment.start", "feature.publish"]
    : ["experiment.draft"];
}

// What an update does to a live experiment, in the Make Changes flow's terms.
// Edits to a draft aren't live, so only starting it counts.
export function experimentChangeActions(
  existing: Omit<ExperimentInterface, "id" | "dateCreated" | "dateUpdated">,
  changes: Partial<ExperimentInterface>,
): ConfirmAction[] {
  const actions = new Set<ConfirmAction>(
    statusActions(existing.status, changes.status),
  );
  const schedule = changes.statusUpdateSchedule;
  if (schedule && !isEqual(schedule, existing.statusUpdateSchedule)) {
    scheduleActions(schedule).forEach((action) => actions.add(action));
  }
  // Clearing a schedule cancels a start or stop that was due.
  if (schedule === null && existing.statusUpdateSchedule) {
    actions.add("experiment.other");
  }
  if (existing.status === "draft") {
    const schedule =
      "statusUpdateSchedule" in changes
        ? changes.statusUpdateSchedule
        : existing.statusUpdateSchedule;
    // A draft armed to start ships its edits when it starts, so they hold as on
    // a live experiment, and as the start. Echoing "draft" leaves it armed.
    if (schedule?.startAt && (changes.status ?? "draft") === "draft") {
      actions.add("experiment.start");
      experimentChangeActions(
        { ...existing, status: "running" },
        omit(changes, ["status", "statusUpdateSchedule"]),
      ).forEach((action) => actions.add(action));
    }
    return [...actions];
  }

  if (RERANDOMIZE_FIELDS.some((f) => changed(existing[f], changes[f]))) {
    actions.add("experiment.phases");
  }
  const before = existing.phases ?? [];
  const after = changes.phases;
  if (after) {
    if (after.length !== before.length) {
      actions.add("experiment.phases");
      // A new latest phase is what serves, so it's compared with the old one.
      const [was, now] = [before.at(-1), after.at(-1)];
      for (const [field, action] of PHASE_ACTIONS) {
        if (was && now && differs(was[field], now[field])) actions.add(action);
      }
    }
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

// What changing each field of a live bandit holds as, or null when it never
// reaches users. Fields not listed hold as experiment.other.
const BANDIT_FIELD_ACTIONS: Partial<
  Record<keyof ContextualBanditInterface, ConfirmAction | null>
> = {
  coverage: "experiment.traffic",
  condition: "experiment.targeting",
  savedGroups: "experiment.targeting",
  prerequisites: "experiment.targeting",
  seed: "experiment.phases",
  hashAttribute: "experiment.phases",
  trackingKey: "experiment.phases",
  name: null,
  description: null,
  owner: null,
  tags: null,
};

// A bandit update holds like an experiment's: a draft's edits are draft work, and
// a live one's by what they change about how it serves.
export function contextualBanditChangeActions(
  existing: ContextualBanditInterface,
  changes: Partial<ContextualBanditInterface>,
): ConfirmAction[] {
  const actions = new Set(statusActions(existing.status, changes.status));
  if (existing.status !== "draft") {
    if (
      changes.archived !== undefined &&
      changes.archived !== !!existing.archived
    ) {
      actions.add(
        existing.status !== "running"
          ? "experiment.other"
          : changes.archived
            ? "experiment.stop"
            : "experiment.start",
      );
    }
    const before = existing as Record<string, unknown>;
    for (const [field, after] of Object.entries(changes)) {
      if (field === "status" || field === "archived") continue;
      if (!changed(before[field], after)) continue;
      const action =
        BANDIT_FIELD_ACTIONS[field as keyof ContextualBanditInterface];
      if (action !== null) actions.add(action ?? "experiment.other");
    }
  }
  return actions.size ? [...actions] : ["experiment.draft"];
}

const INTERLEAVING_FIELD_ACTIONS: Partial<
  Record<keyof InterleavingInterface, ConfirmAction | null>
> = {
  coverage: "experiment.traffic",
  condition: "experiment.targeting",
  savedGroups: "experiment.targeting",
  prerequisites: "experiment.targeting",
  environmentSettings: "experiment.targeting",
  seed: "experiment.phases",
  hashAttribute: "experiment.phases",
  trackingKey: "experiment.phases",
  name: null,
  description: null,
  owner: null,
  tags: null,
  archived: null,
};

export function interleavingChangeActions(
  existing: InterleavingInterface,
  changes: Partial<InterleavingInterface>,
): ConfirmAction[] {
  const actions = new Set<ConfirmAction>();
  if (existing.status !== "draft") {
    const before = existing as Record<string, unknown>;
    for (const [field, after] of Object.entries(changes)) {
      if (!changed(before[field], after)) continue;
      const action =
        INTERLEAVING_FIELD_ACTIONS[field as keyof InterleavingInterface];
      if (action !== null) actions.add(action ?? "experiment.other");
    }
  }
  return actions.size ? [...actions] : ["experiment.draft"];
}
