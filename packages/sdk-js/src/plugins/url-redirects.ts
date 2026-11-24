import type { NavigateCallback, Plugin } from "../types/growthbook";
import { isURLTargeted, mergeQueryStrings, promiseTimeout } from "../util";
import { addAutoExperimentHandler } from "./utils/auto-experiments";

export type UrlRedirectsPluginOptions = {
  /**
   * A redirect to another origin (protocol or host) can send visitors to a
   * site you don't control. Without this, an experiment where any variation
   * redirects to another origin doesn't run.
   */
  allowCrossOriginRedirects?: boolean;
  navigate?: NavigateCallback;
  navigateDelay?: number;
  maxNavigateDelay?: number;
};

/** Runs the URL redirect experiments in the payload. */
export function urlRedirectsPlugin({
  allowCrossOriginRedirects,
  navigate,
  navigateDelay,
  maxNavigateDelay,
}: UrlRedirectsPluginOptions = {}): Plugin {
  const isBrowser =
    typeof window !== "undefined" && typeof document !== "undefined";
  // In the browser, the default navigation waits a moment for tracking to fire
  const delay = navigateDelay ?? (navigate ? 0 : 100);
  if (!navigate && isBrowser) {
    navigate = (url) => {
      window.location.replace(url);
    };
  }

  const go = (url: string) => {
    try {
      navigate && navigate(url);
    } catch (e) {
      console.error(e);
    }
  };

  return (gb) =>
    addAutoExperimentHandler(gb, "redirect", (gb, runner) => ({
      isBlocked: (experiment, currentUrl) => {
        try {
          const current = new URL(currentUrl);
          for (const v of experiment.variations) {
            if (!v || !v.urlRedirect) continue;
            const url = new URL(v.urlRedirect);
            if (
              !allowCrossOriginRedirects &&
              (url.protocol !== current.protocol || url.host !== current.host)
            ) {
              return true;
            }
          }
        } catch (e) {
          // Problem parsing one of the URLs
          gb.log("Error parsing current or redirect URL", {
            id: experiment.key,
            error: e,
          });
          return true;
        }
        return false;
      },
      apply: (experiment, value, currentUrl, trackingCall) => {
        if (!value.urlRedirect || !experiment.urlPatterns) return;

        const url = experiment.persistQueryString
          ? mergeQueryStrings(currentUrl, value.urlRedirect)
          : value.urlRedirect;

        if (isURLTargeted(url, experiment.urlPatterns)) {
          gb.log(
            "Skipping redirect because original URL matches redirect URL",
            { id: experiment.key },
          );
          return;
        }
        runner.redirectUrl = url;
        if (!navigate) return;

        if (!isBrowser) {
          go(url);
          return;
        }
        // Wait for the possibly-async tracking callback, bound by min and max delays
        Promise.all([
          ...(trackingCall
            ? [promiseTimeout(trackingCall, maxNavigateDelay ?? 1000)]
            : []),
          new Promise((resolve) => window.setTimeout(resolve, delay)),
        ]).then(() => go(url));
      },
    }));
}
