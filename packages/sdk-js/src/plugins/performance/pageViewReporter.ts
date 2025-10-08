import { GrowthBook } from "../../GrowthBook";
import type {
  GrowthBookClient,
  UserScopedGrowthBook,
} from "../../GrowthBookClient";
import { detectEnv, shouldSample } from "./util";

export type PageViewReporterSettings = {
  samplingRate?: number;
  hashAttribute?: string;
  growthbook: GrowthBook | UserScopedGrowthBook | GrowthBookClient;
};

export function createPageViewReporter({
  samplingRate = 1,
  hashAttribute = "id",
  growthbook,
}: PageViewReporterSettings) {
  if (samplingRate < 0 || samplingRate > 1) {
    throw new Error("samplingRate must be between 0 and 1");
  }

  const env = detectEnv();
  if (env !== "browser") {
    throw new Error("Page view tracking only works in the browser");
  }
  if (!(growthbook instanceof GrowthBook)) {
    throw new Error("Page view tracking requires a GrowthBook instance");
  }

  if (
    !shouldSample({
      rate: samplingRate,
      hashAttribute,
      attributes: growthbook.getAttributes(),
      seed: "pageview-sampling",
    })
  ) {
    return;
  }

  let observing = true;
  const stopObserving = () => {
    observing = false;
    urlPolling = false;
  };

  "onDestroy" in growthbook && growthbook.onDestroy(stopObserving);

  let currentPath = window.location.origin + window.location.pathname;

  const reportPageView = () => {
    if (!observing) return;
    growthbook.logEvent("page_view");
  };

  const reportIfUrlChanged = (newPath: string) => {
    if (newPath !== currentPath) {
      currentPath = newPath;
      reportPageView();
    }
  };

  reportPageView();

  // Track SPAs using navigation (new API, not widely supported yet)
  if ("navigation" in window) {
    // @ts-expect-error: Navigate API might be missing from types
    window.navigation.addEventListener("navigate", (event) => {
      if (event?.destination?.url) {
        try {
          const url = new URL(event.destination.url);
          reportIfUrlChanged(url.origin + url.pathname);
        } catch {
          // Invalid URL, ignore
        }
      }
    });
  }

  // Track using history changes
  const methods = ["pushState", "replaceState"] as const;
  methods.forEach((method) => {
    const original = window.history[method];
    window.history[method] = function (...args) {
      const result = original.apply(this, args);
      reportIfUrlChanged(window.location.origin + window.location.pathname);
      return result;
    };
  });
  window.addEventListener("popstate", () => {
    reportIfUrlChanged(window.location.origin + window.location.pathname);
  });

  // Track using legacy url-change polling strategy
  let urlPolling = true;
  const checkForUrlChanges = () => {
    if (!urlPolling) return;
    reportIfUrlChanged(window.location.origin + window.location.pathname);
    setTimeout(checkForUrlChanges, 500);
  };
  checkForUrlChanges();
}
