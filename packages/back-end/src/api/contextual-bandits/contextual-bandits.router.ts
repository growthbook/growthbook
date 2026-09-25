import type { contextualBanditEndpoints } from "shared/api-endpoints";
import { OpenApiRoute } from "back-end/src/util/handler";
import { listContextualBandits } from "./listContextualBandits";
import { createContextualBandit } from "./createContextualBandit";
import { getContextualBandit } from "./getContextualBandit";
import { updateContextualBandit } from "./updateContextualBandit";
import { startContextualBandit } from "./startContextualBandit";
import { stopContextualBandit } from "./stopContextualBandit";
import { refreshContextualBandit } from "./refreshContextualBandit";
import { updateContextualBanditVariations } from "./updateContextualBanditVariations";
import { cancelContextualBandit } from "./cancelContextualBandit";
import { getContextualBanditCurrentWeights } from "./getCurrent";
import { listContextualBanditSnapshots } from "./listSnapshots";
import { getContextualBanditSnapshot } from "./getSnapshot";
import { listContextualBanditEvents } from "./listEvents";
import { getContextualBanditEvent } from "./getEvent";
import { getContextualBanditResults } from "./getResults";
import { getContextualBanditLinkedFeatures } from "./getLinkedFeatures";
import { addContextualBanditLinkedFeature } from "./addLinkedFeature";
import { updateContextualBanditLinkedFeature } from "./updateLinkedFeature";
import { deleteContextualBanditLinkedFeature } from "./deleteLinkedFeature";

// One entry per export of contextualBanditEndpoints: a missing handler or a
// leftover one for a deleted endpoint fails type-checking.
const routes = {
  listContextualBandits,
  createContextualBandit,
  getContextualBandit,
  updateContextualBandit,
  startContextualBandit,
  stopContextualBandit,
  refreshContextualBandit,
  updateContextualBanditVariations,
  cancelContextualBandit,
  getContextualBanditCurrentWeights,
  listContextualBanditSnapshots,
  getContextualBanditSnapshot,
  listContextualBanditEvents,
  getContextualBanditEvent,
  getContextualBanditResults,
  getContextualBanditLinkedFeatures,
  addContextualBanditLinkedFeature,
  updateContextualBanditLinkedFeature,
  deleteContextualBanditLinkedFeature,
} satisfies Record<keyof typeof contextualBanditEndpoints, OpenApiRoute>;

export const contextualBanditsRoutes: OpenApiRoute[] = Object.values(routes);
