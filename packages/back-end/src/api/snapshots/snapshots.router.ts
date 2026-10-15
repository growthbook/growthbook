import { OpenApiRoute } from "back-end/src/util/handler";
import { getExperimentSnapshot } from "./getExperimentSnapshot";
import { postSnapshotAnalysis, postSnapshotCancel } from "./snapshotActions";

export const snapshotsRoutes: OpenApiRoute[] = [
  getExperimentSnapshot,
  postSnapshotCancel,
  postSnapshotAnalysis,
];
