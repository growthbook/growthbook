import { OpenApiRoute } from "back-end/src/util/handler";
import { getContextualBanditCurrentWeights } from "./getCurrent";
import { listContextualBanditSnapshots } from "./listSnapshots";
import { getContextualBanditSnapshot } from "./getSnapshot";
import { listContextualBanditEvents } from "./listEvents";
import { getContextualBanditEvent } from "./getEvent";
import { getContextualBanditResults } from "./getResults";

export const contextualBanditsRoutes: OpenApiRoute[] = [
  getContextualBanditCurrentWeights,
  listContextualBanditSnapshots,
  getContextualBanditSnapshot,
  listContextualBanditEvents,
  getContextualBanditEvent,
  getContextualBanditResults,
];
