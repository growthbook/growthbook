import { OpenApiRoute } from "back-end/src/util/handler";
import { listFeatures } from "./listFeatures";
import { toggleFeature } from "./toggleFeature";
import { revertFeature } from "./revertFeature";
import { getFeature } from "./getFeature";
import { postFeature } from "./postFeature";
import { updateFeature } from "./updateFeature";
import { deleteFeatureById } from "./deleteFeature";
import { getFeatureRevisions } from "./getFeatureRevisions";
import { getFeatureKeys } from "./getFeatureKeys";
import { getFeatureStale } from "./getFeatureStale";

export const featureRoutes: OpenApiRoute[] = [
  listFeatures,
  postFeature,
  getFeature,
  updateFeature,
  deleteFeatureById,
  toggleFeature,
  revertFeature,
  getFeatureRevisions,
  getFeatureKeys,
  getFeatureStale,
];
