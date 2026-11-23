import type {
  AutoExperimentFeature,
  OrganizationSettings,
} from "shared/types/organization";
import type { SDKConnectionInterface } from "shared/types/sdk-connection";

export const AUTO_EXPERIMENT_FEATURES = [
  "visualEditor",
  "urlRedirects",
  "customJs",
  "crossOriginRedirects",
] as const satisfies readonly AutoExperimentFeature[];

// What the instance lets organizations do. Cloud is always "allowed".
// "existing-only" keeps what an organization already uses but lets nothing new
// be turned on; "disabled" turns everything off.
export type AutoExperimentsMode = "allowed" | "existing-only" | "disabled";

const PARENT_FEATURE: Partial<
  Record<AutoExperimentFeature, AutoExperimentFeature>
> = {
  customJs: "visualEditor",
  crossOriginRedirects: "urlRedirects",
};

export function getAutoExperimentParentFeature(
  feature: AutoExperimentFeature,
): AutoExperimentFeature | null {
  return PARENT_FEATURE[feature] ?? null;
}

export function isAutoExperimentFeatureEnabled(
  settings: Pick<OrganizationSettings, "autoExperiments"> | undefined,
  feature: AutoExperimentFeature,
  mode: AutoExperimentsMode,
): boolean {
  if (mode === "disabled") return false;
  const parent = PARENT_FEATURE[feature];
  if (parent && !isAutoExperimentFeatureEnabled(settings, parent, mode)) {
    return false;
  }
  // Unset means the organization predates the opt-in and keeps what it had.
  return settings?.autoExperiments?.[feature] ?? true;
}

type ConnectionAutoExperimentFlags = Pick<
  SDKConnectionInterface,
  | "includeVisualExperiments"
  | "includeRedirectExperiments"
  | "allowCustomJs"
  | "allowCrossOriginRedirects"
>;

// Unset `allow*` means the SDK Connection predates the setting and keeps
// serving what it served before.
export function connectionServesAutoExperimentFeature(
  connection: ConnectionAutoExperimentFlags,
  feature: AutoExperimentFeature,
): boolean {
  switch (feature) {
    case "visualEditor":
      return !!connection.includeVisualExperiments;
    case "urlRedirects":
      return !!connection.includeRedirectExperiments;
    case "customJs":
      return (
        !!connection.includeVisualExperiments &&
        (connection.allowCustomJs ?? true)
      );
    case "crossOriginRedirects":
      return (
        !!connection.includeRedirectExperiments &&
        (connection.allowCrossOriginRedirects ?? true)
      );
  }
}

export function hasCustomJs(visualChanges: { js?: string }[]): boolean {
  return visualChanges.some((c) => !!c.js?.trim());
}

function parseOrigin(url: string): { protocol: string; host: string } | null {
  try {
    const { protocol, host } = new URL(url);
    return { protocol, host };
  } catch (e) {
    return null;
  }
}

// Matches the SDK's own check: a different protocol or host is cross-origin.
// A URL that can't be read can't be shown to be same-origin, so it counts too.
// So does any destination that isn't https: SDKs match the page's URL without
// its protocol, so an http-to-http redirect also runs on the https page and
// would take a visitor off it.
export function isCrossOriginRedirect(redirect: {
  urlPattern: string;
  destinationURLs: { url: string }[];
}): boolean {
  const from = parseOrigin(redirect.urlPattern);
  return redirect.destinationURLs.some(({ url }) => {
    // No destination: the variation stays on the original page.
    if (!url) return false;
    const to = parseOrigin(url);
    return (
      !from ||
      !to ||
      to.protocol !== "https:" ||
      to.protocol !== from.protocol ||
      to.host !== from.host
    );
  });
}

type RedirectUrls = {
  urlPattern: string;
  destinationURLs: { variation: string; url: string }[];
};

// True when `next` sends no variation anywhere `stored` didn't already. Adding
// a variation with no destination, or removing or reordering variations, keeps
// it true, so the list can follow the experiment's variations.
export function redirectKeepsStoredUrls(
  next: RedirectUrls,
  stored: RedirectUrls,
): boolean {
  return (
    next.urlPattern === stored.urlPattern &&
    next.destinationURLs.every(
      (d) =>
        !d.url ||
        stored.destinationURLs.some(
          (s) => s.variation === d.variation && s.url === d.url,
        ),
    )
  );
}
