import type { GrowthBook } from "../../GrowthBook";
import type { AnyGrowthBook } from "../utils/instance";

export type SessionReplayApi = {
  start: () => void;
  stop: () => void;
};

const controlsByInstance = new WeakMap<object, SessionReplayApi>();

export function registerSessionReplay(
  gb: GrowthBook,
  api: SessionReplayApi,
): boolean {
  if (controlsByInstance.has(gb)) {
    console.warn(
      "[GrowthBook] sessionReplayPlugin registered more than once — " +
        "keeping the first recorder and discarding the duplicate. Check your plugins array for duplicates.",
    );
    return false;
  }
  controlsByInstance.set(gb, api);
  return true;
}

export function unregisterSessionReplay(
  gb: GrowthBook,
  api: SessionReplayApi,
): void {
  if (controlsByInstance.get(gb) === api) controlsByInstance.delete(gb);
}

export function getSessionReplay(
  gb: AnyGrowthBook,
): SessionReplayApi | undefined {
  return controlsByInstance.get(gb);
}
