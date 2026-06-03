import { OpenApiRoute } from "back-end/src/util/handler";
import { getCbCurrent } from "./getCurrent";
import { listCbSnapshots } from "./listSnapshots";
import { getCbSnapshot } from "./getSnapshot";
import { listCbEvents } from "./listEvents";
import { getCbEvent } from "./getEvent";
import { getCbResults } from "./getResults";

/**
 * Read-side CB endpoints under `/api/v1/contextual-bandits/*`.
 *
 * Mounted as non-BaseModel routes because the spec-pattern apiConfig in
 * `ContextualBanditModel.ts` runs out of TypeScript inference budget once
 * more than ~3 custom handlers share the file (the GET surface adds 6
 * additional handlers). Ship them here instead; the CRUD + lifecycle
 * (start/stop/refresh) surface continues to live on the spec-pattern.
 *
 * Snapshot/event list endpoints come before the single-item ones so the
 * `:snapshotId` / `:eventId` path params don't accidentally swallow the
 * `/snapshots` and `/events` collection paths.
 */
export const contextualBanditsRoutes: OpenApiRoute[] = [
  getCbCurrent,
  listCbSnapshots,
  getCbSnapshot,
  listCbEvents,
  getCbEvent,
  getCbResults,
];
