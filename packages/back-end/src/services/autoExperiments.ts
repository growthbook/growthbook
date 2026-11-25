import isEqual from "lodash/isEqual";
import uniqBy from "lodash/uniqBy";
import { z } from "zod";
import {
  AUTO_EXPERIMENT_FEATURES,
  connectionServesAutoExperimentFeature,
  getAutoExperimentParentFeature,
  hasCustomJs,
  hasVisualChanges,
  isAutoExperimentFeatureEnabled,
  isCrossOriginRedirect,
  redirectKeepsStoredUrls,
} from "shared/util";
import type { AutoExperimentUsage } from "shared/util";
import type { ExperimentInterface } from "shared/types/experiment";
import type {
  AutoExperimentFeature,
  OrganizationInterface,
  OrganizationSettings,
} from "shared/types/organization";
import type { SDKConnectionInterface } from "shared/types/sdk-connection";
import type { URLRedirectInterface } from "shared/types/url-redirect";
import type { VisualChange } from "shared/types/visual-changeset";
import type { ApiReqContext } from "back-end/types/api";
import type { CbVisualExperiment } from "back-end/src/services/contextualBanditPayload";
import type {
  URLRedirectExperiment,
  VisualExperiment,
} from "back-end/src/services/features";
import type { ReqContext } from "back-end/types/request";
import { BadRequestError } from "back-end/src/util/errors";
import { AUTO_EXPERIMENTS_MODE } from "back-end/src/util/secrets";

type Context = ReqContext | ApiReqContext;

const NOT_ENABLED: Record<AutoExperimentFeature, string> = {
  visualEditor: "AI Visual Editor experiments are not enabled",
  urlRedirects: "URL redirect experiments are not enabled",
  customJs: "Custom JavaScript in AI Visual Editor experiments is not enabled",
  crossOriginRedirects: "URL redirects to a different origin are not enabled",
};

export function orgHasAutoExperimentFeature(
  org: Pick<OrganizationInterface, "settings">,
  feature: AutoExperimentFeature,
): boolean {
  return isAutoExperimentFeatureEnabled(
    org.settings,
    feature,
    AUTO_EXPERIMENTS_MODE,
  );
}

export function assertAutoExperimentFeatureEnabled(
  context: Context,
  feature: AutoExperimentFeature,
): void {
  if (orgHasAutoExperimentFeature(context.org, feature)) return;
  throw new BadRequestError(
    AUTO_EXPERIMENTS_MODE === "disabled"
      ? `${NOT_ENABLED[feature]} on this GrowthBook instance.`
      : `${NOT_ENABLED[feature]} for this organization. An admin can enable them in Settings.`,
  );
}

type ChangeContent = Partial<
  Pick<VisualChange, "id" | "css" | "js" | "domMutations">
>;

const changeContent = ({ css, js, domMutations }: ChangeContent) => [
  css || "",
  js || "",
  domMutations ?? [],
];

// A change identical to its `stored` version is skipped, so the empty changes
// added when variations change still save in an organization that has since
// turned the feature off. `always` is for a write a person asked for.
export function assertVisualChangesAllowed(
  context: Context,
  changes: ChangeContent[],
  {
    stored = [],
    always = false,
  }: { stored?: VisualChange[]; always?: boolean } = {},
): void {
  const edited = changes.flatMap((change) => {
    const prev = stored.find((c) => c.id === change.id);
    const next = { ...prev, ...change };
    return isEqual(changeContent(next), changeContent(prev ?? {}))
      ? []
      : [{ prev, next }];
  });
  if (always || edited.length) {
    assertAutoExperimentFeatureEnabled(context, "visualEditor");
  }
  if (
    edited.some(
      ({ prev, next }) => hasCustomJs([next]) && next.js !== (prev?.js ?? ""),
    )
  ) {
    assertAutoExperimentFeatureEnabled(context, "customJs");
  }
}

type RedirectTarget = Pick<
  URLRedirectInterface,
  "urlPattern" | "destinationURLs"
>;

// As above: a redirect whose URLs are unchanged is skipped, so the destination
// list can still follow the experiment's variations.
export function assertUrlRedirectAllowed(
  context: Context,
  redirect: RedirectTarget,
  stored?: RedirectTarget,
): void {
  if (stored && redirectKeepsStoredUrls(redirect, stored)) return;
  assertAutoExperimentFeatureEnabled(context, "urlRedirects");
  if (isCrossOriginRedirect(redirect)) {
    assertAutoExperimentFeatureEnabled(context, "crossOriginRedirects");
  }
}

type ConnectionFlags = Pick<
  SDKConnectionInterface,
  | "includeVisualExperiments"
  | "includeRedirectExperiments"
  | "allowCustomJs"
  | "allowCrossOriginRedirects"
>;

// What a payload may carry: the organization and the SDK Connection both have
// to opt in.
export function getAutoExperimentAccess(
  org: Pick<OrganizationInterface, "settings">,
  connection: ConnectionFlags,
): Record<AutoExperimentFeature, boolean> {
  const access = (feature: AutoExperimentFeature) =>
    orgHasAutoExperimentFeature(org, feature) &&
    connectionServesAutoExperimentFeature(connection, feature);
  return {
    visualEditor: access("visualEditor"),
    urlRedirects: access("urlRedirects"),
    customJs: access("customJs"),
    crossOriginRedirects: access("crossOriginRedirects"),
  };
}

type LiveOwner = AutoExperimentUsage[AutoExperimentFeature]["items"][number] & {
  project?: string;
};

// What turning each opt-in off would stop serving, from what the payload
// builder delivers. Takes contextual bandits already narrowed to the served
// ones. A draft only reaches SDK Connections that ask for drafts, so it is
// left out.
export function getLiveAutoExperimentUsage({
  visualExperiments,
  redirectExperiments,
  cbVisualExperiments,
  canReadProject,
}: {
  visualExperiments: VisualExperiment[];
  redirectExperiments: URLRedirectExperiment[];
  cbVisualExperiments: CbVisualExperiment[];
  canReadProject: (project: string | undefined) => boolean;
}): AutoExperimentUsage {
  const fromExperiment = (e: ExperimentInterface): LiveOwner => ({
    kind: "experiment",
    id: e.id,
    name: e.name,
    project: e.project,
    ...(e.status === "stopped" ? { rollout: true } : {}),
  });
  const visual = [
    ...visualExperiments
      .filter(
        (e) =>
          e.experiment.status !== "draft" &&
          hasVisualChanges(e.visualChangeset.visualChanges),
      )
      .map((e) => ({
        owner: fromExperiment(e.experiment),
        changeset: e.visualChangeset,
      })),
    ...cbVisualExperiments.map((e) => ({
      owner: {
        kind: "contextual-bandit" as const,
        id: e.contextualBandit.id,
        name: e.contextualBandit.name,
        project: e.contextualBandit.project,
      },
      changeset: e.visualChangeset,
    })),
  ];
  const redirects = redirectExperiments.filter(
    (e) => e.experiment.status !== "draft",
  );
  // One experiment can hold several changesets.
  const describe = (list: LiveOwner[]) => {
    const owners = uniqBy(list, (o) => `${o.kind}:${o.id}`);
    return {
      total: owners.length,
      items: owners
        .filter((o) => canReadProject(o.project))
        .map(({ kind, id, name, rollout }) => ({ kind, id, name, rollout })),
    };
  };
  return {
    visualEditor: describe(visual.map((v) => v.owner)),
    customJs: describe(
      visual
        .filter((v) => hasCustomJs(v.changeset.visualChanges))
        .map((v) => v.owner),
    ),
    urlRedirects: describe(redirects.map((r) => fromExperiment(r.experiment))),
    crossOriginRedirects: describe(
      redirects
        .filter((r) => isCrossOriginRedirect(r.urlRedirect))
        .map((r) => fromExperiment(r.experiment)),
    ),
  };
}

// An SDK Connection can't opt in to what the organization hasn't.
export function assertConnectionAutoExperimentsAllowed(
  context: Context,
  next: ConnectionFlags,
  prev?: ConnectionFlags,
): void {
  for (const feature of AUTO_EXPERIMENT_FEATURES) {
    if (
      connectionServesAutoExperimentFeature(next, feature) &&
      !(prev && connectionServesAutoExperimentFeature(prev, feature))
    ) {
      assertAutoExperimentFeatureEnabled(context, feature);
    }
  }
}

// Merged over what is stored, so a caller can send one feature at a time.
export function getAutoExperimentSettingsUpdate(
  context: Context,
  input: unknown,
): NonNullable<OrganizationSettings["autoExperiments"]> {
  if (context.isApiRequest || !context.permissions.canManageOrgSettings()) {
    context.permissions.throwPermissionError();
  }
  const requested = z
    .object(
      Object.fromEntries(
        AUTO_EXPERIMENT_FEATURES.map((f) => [f, z.boolean().optional()]),
      ),
    )
    .strict()
    .parse(input);
  const next = { ...context.org.settings?.autoExperiments, ...requested };
  for (const feature of AUTO_EXPERIMENT_FEATURES) {
    const parent = getAutoExperimentParentFeature(feature);
    if (parent && next[parent] === false) next[feature] = false;
    const turnsOn =
      next[feature] === true &&
      context.org.settings?.autoExperiments?.[feature] === false;
    if (turnsOn && AUTO_EXPERIMENTS_MODE !== "allowed") {
      context.throwBadRequestError(
        "This GrowthBook instance does not allow enabling AI Visual Editor or URL redirect experiments. Set the ALLOW_AUTO_EXPERIMENTS environment variable to true to allow it.",
      );
    }
  }
  return next;
}
