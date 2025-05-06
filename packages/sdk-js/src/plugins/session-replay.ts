import { record } from "rrweb";
import type { eventWithTime } from "@rrweb/types";
import { GrowthBook } from "../GrowthBook";
import { GrowthBookClient, UserScopedGrowthBook } from "../GrowthBookClient";

type PluginOptions = {
  trackingHost?: string;
};

declare global {
  interface Window {
    _gbReplayEvents: eventWithTime[];
  }
}

export function sessionReplayPlugin({ trackingHost = "" }: PluginOptions = {}) {
  console.log("session replay init");
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("rrwebPlugin only works in the browser");
  }

  return (gb: GrowthBook | UserScopedGrowthBook | GrowthBookClient) => {
    // todo: get proper track URLs
    // const host = trackingHost || gb.getApiInfo()[0];
    // const metadataUrl = `${host}/`;
    console.log("session replay cb start", trackingHost);
    if (!(gb instanceof GrowthBook)) {
      throw new Error("Must use a GrowthBook SDK instance");
    }
    if (!gb.logEvent) {
      throw new Error("GrowthBook instance must have a logEvent method");
    }

    window._gbReplayEvents = window._gbReplayEvents || [];

    const stopRecording = record({
      emit(event: eventWithTime) {
        window._gbReplayEvents.push(event);
      },
      recordCanvas: false,
      sampling: {
        mousemove: true,
        mouseInteraction: true,
        scroll: 150,
        input: "last",
      },
    });

    if (!stopRecording) {
      console.error("rrweb failed to start");
      return;
    }

    const flushBuffer = () => {
      if (window._gbReplayEvents?.length === 0) return;

      const evaluatedExperiments = Array.from(
        gb.getAllResults().entries()
      ).reduce((acc, [key, { result }]) => {
        acc[key] = result.value.variationId;
        return acc;
      }, {} as Record<string, number>);

      const context = {
        attributes: gb.getAttributes(),
        // features: //todo
        experiments: evaluatedExperiments,
      };

      // todo: split metadata from replay events
      gb.logEvent("rrweb:session", {
        context,
        events: window._gbReplayEvents,
      });
      window._gbReplayEvents.length = 0;
    };

    window.addEventListener("pagehide", flushBuffer);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushBuffer();
    });

    "onDestroy" in gb &&
      gb.onDestroy(() => {
        flushBuffer();
        stopRecording();
      });
  };
}
