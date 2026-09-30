import { GrowthBook } from "@growthbook/growthbook-react";
import { EVENT_NAMES, track } from "./analytics";

const VISITOR_KEY = "cedar-market-visitor-id";

function getVisitorId(): string {
  try {
    const existing = localStorage.getItem(VISITOR_KEY);
    if (existing) return existing;
    const id = `vis_${crypto.randomUUID()}`;
    localStorage.setItem(VISITOR_KEY, id);
    return id;
  } catch {
    return `vis_${Math.random().toString(36).slice(2)}`;
  }
}

const apiHost =
  import.meta.env.VITE_GB_API_HOST?.trim() || "http://localhost:3100";
const clientKey = import.meta.env.VITE_GB_CLIENT_KEY?.trim() || "";
const decryptionKey = import.meta.env.VITE_GB_DECRYPTION_KEY?.trim() || "";

export const growthbookConfig = {
  apiHost,
  clientKey,
  hasClientKey: Boolean(clientKey) && clientKey !== "sdk-CHANGE_ME",
};

export const growthbook = new GrowthBook({
  apiHost,
  clientKey: growthbookConfig.hasClientKey ? clientKey : undefined,
  decryptionKey: decryptionKey || undefined,
  enableDevMode: true,
  attributes: {
    id: getVisitorId(),
    url: typeof window !== "undefined" ? window.location.pathname : "/",
  },
  trackingCallback: (experiment, result) => {
    track(EVENT_NAMES.experimentViewed, {
      experimentId: experiment.key,
      variationId: result.key,
      variationName: result.name,
      featureId: result.featureId,
      inExperiment: result.inExperiment,
    });
  },
});

export async function initGrowthBook(): Promise<void> {
  if (!growthbookConfig.hasClientKey) {
    console.info(
      "[GrowthBook] No VITE_GB_CLIENT_KEY set — running with flag defaults. Copy .env.example to .env.local and add your SDK key.",
    );
    return;
  }

  try {
    const result = await growthbook.init({ streaming: true, timeout: 3000 });
    if (result.error) {
      console.warn("[GrowthBook] init warning:", result.error);
    }
  } catch (err) {
    console.warn(
      "[GrowthBook] Could not reach API — continuing with defaults.",
      err,
    );
  }
}
