import { OpenApiRoute } from "back-end/src/util/handler";
import { getContextualBanditCurrentWeights } from "./getCurrent";
import { listContextualBanditSnapshots } from "./listSnapshots";
import { getContextualBanditSnapshot } from "./getSnapshot";
import { listContextualBanditEvents } from "./listEvents";
import { getContextualBanditEvent } from "./getEvent";
import { getContextualBanditResults } from "./getResults";
import { getContextualBanditLinkedFeatures } from "./getLinkedFeatures";
import { deleteContextualBanditLinkedFeature } from "./deleteLinkedFeature";

export const contextualBanditsRoutes: OpenApiRoute[] = [
  getContextualBanditCurrentWeights,
  listContextualBanditSnapshots,
  getContextualBanditSnapshot,
  listContextualBanditEvents,
  getContextualBanditEvent,
  getContextualBanditResults,
  getContextualBanditLinkedFeatures,
  deleteContextualBanditLinkedFeature,
];
