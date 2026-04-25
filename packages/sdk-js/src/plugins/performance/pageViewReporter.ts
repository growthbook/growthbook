import { GrowthBook } from "../../GrowthBook";
import type {
  GrowthBookClient,
  UserScopedGrowthBook,
} from "../../GrowthBookClient";
import { detectEnv, shouldSample, syncGrowthBookUrl } from "./util";
import { subscribeToUrlChanges } from "./urlChangeObserver";

export type PageViewReporterSettings = {
  samplingRate?: number;
  hashAttribute?: string;
  // Fire page_view on query-string changes too (default: pathname-only)
  trackQueryStringChanges?: boolean;
  enableUrlPolling?: boolean;
  growthbook: GrowthBook | UserScopedGrowthBook | GrowthBookClient;
};

export function createPageViewReporter({
  samplingRate = 1,
  hashAttribute = "id",
  trackQueryStringChanges = false,
  enableUrlPolling = false,
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

  let stopped = false;
  let unsubscribe: (() => void) | null = null;

  const reportPageView = () => {
    if (stopped) return;
    syncGrowthBookUrl(growthbook);
    growthbook.logEvent("page_view");
  };

  // bfcache restore — re-fire page_view on back/forward navigations
  const onPageShow = (event: PageTransitionEvent) => {
    event.persisted && reportPageView();
  };
  window.addEventListener("pageshow", onPageShow);

  growthbook.onDestroy(() => {
    stopped = true;
    unsubscribe?.();
    unsubscribe = null;
    window.removeEventListener("pageshow", onPageShow);
  });

  // Initial page view
  reportPageView();

  // SPA navigations
  unsubscribe = subscribeToUrlChanges(reportPageView, {
    trackQueryString: trackQueryStringChanges,
    enablePolling: enableUrlPolling,
  });
}
