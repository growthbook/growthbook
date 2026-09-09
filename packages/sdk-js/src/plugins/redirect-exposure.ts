/**
 * Keeps URL-redirect exposures from being lost. A redirect experiment
 * navigates away about 100ms after its tracking callback fires, often before
 * the analytics library has loaded, so the event dies with the page and the
 * redirect variation under-counts (SRM). The exposure is persisted before the
 * redirect and replayed on the destination page unless the tracking callback
 * settled first. Wraps the tracking callback, so apply it after any plugin
 * that sets one. Browser only.
 */
import type { AutoExperiment, TrackingData } from "../types/growthbook";
import { getAutoExperimentChangeType } from "../util";
import { getLocalStorage } from "./utils/storage";
import { isFullGrowthBook, type AnyGrowthBook } from "./utils/instance";

const STORAGE_KEY = "gb_redirect_exposure";
const TTL_MS = 60_000;

type PendingExposure = TrackingData & { url: string; date: number };

export function redirectExposurePlugin() {
  return (gb: AnyGrowthBook) => {
    if (typeof window === "undefined" || !isFullGrowthBook(gb)) return;
    const storage = getLocalStorage();
    const cb = gb.getTrackingCallback();
    if (!storage || !cb) return;

    const read = (): PendingExposure | null => {
      try {
        const raw = storage.getItem(STORAGE_KEY);
        return typeof raw === "string" && raw
          ? (JSON.parse(raw) as PendingExposure)
          : null;
      } catch {
        return null;
      }
    };
    const write = (value: PendingExposure | null) => {
      try {
        void storage.setItem(STORAGE_KEY, value ? JSON.stringify(value) : "");
      } catch {
        // storage unavailable
      }
    };

    const pending = read();
    if (pending) {
      write(null);
      if (Date.now() - pending.date < TTL_MS && pending.url !== gb.getUrl()) {
        gb.setDeferredTrackingCalls([pending]);
        void gb.fireDeferredTrackingCalls();
      }
    }

    gb.setTrackingCallback((experiment, result, user) => {
      const ret = cb(experiment, result, user);
      if (
        result.inExperiment &&
        getAutoExperimentChangeType(experiment as AutoExperiment) === "redirect"
      ) {
        // The redirect URL is recorded right after the tracking call returns;
        // a redirect core skipped (already on the target) never records one
        Promise.resolve().then(() => {
          if (!gb.getRedirectUrl()) return;
          write({
            experiment,
            result,
            user,
            url: gb.getUrl(),
            date: Date.now(),
          });
          // A settled promise means the tracker took the event before the
          // page navigated; a void return proves nothing
          if (ret) {
            ret.then(
              () => write(null),
              () => {},
            );
          }
        });
      }
      return ret;
    });
  };
}
