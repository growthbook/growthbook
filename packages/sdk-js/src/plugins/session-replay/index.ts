import { sharePrivacySettings } from "../utils/privacy";
import { isFullGrowthBook, type AnyGrowthBook } from "../utils/instance";
import { createReplayRecorder, type SessionReplayOptions } from "./recorder";

export type {
  SessionReplayPrivacySettings,
  MaskableInputType,
} from "./privacy";
export type { PrivacySettings, UrlScrubSettings } from "../utils/privacy";
export type { SessionReplayOptions } from "./recorder";

export function sessionReplayPlugin(options: SessionReplayOptions = {}) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("sessionReplayPlugin only works in the browser");
  }

  sharePrivacySettings(options.privacy);

  return (gb: AnyGrowthBook) => {
    if (!isFullGrowthBook(gb)) {
      console.warn("sessionReplayPlugin needs a GrowthBook instance, skipping");
      return;
    }
    return createReplayRecorder({ ...options, growthbook: gb });
  };
}
