import { OpenApiRoute } from "back-end/src/util/handler";
import { getCbCurrent } from "./getCurrent";
import { listCbSnapshots } from "./listSnapshots";
import { getCbSnapshot } from "./getSnapshot";
import { listCbEvents } from "./listEvents";
import { getCbEvent } from "./getEvent";
import { getCbResults } from "./getResults";

// List endpoints must be registered before single-item routes so that
// `:snapshotId` / `:eventId` don't swallow `/snapshots` / `/events`.
export const contextualBanditsRoutes: OpenApiRoute[] = [
  getCbCurrent,
  listCbSnapshots,
  getCbSnapshot,
  listCbEvents,
  getCbEvent,
  getCbResults,
];
