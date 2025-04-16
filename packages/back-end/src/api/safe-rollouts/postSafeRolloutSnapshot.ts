import {
  createExperimentSnapshot,
  SNAPSHOT_TIMEOUT,
} from "back-end/src/controllers/experiments";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { auditDetailsCreate } from "back-end/src/services/audit";
import { createSafeRolloutSnapshot } from "back-end/src/services/safeRolloutSnapshots";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { postSafeRolloutSnapshotValidator } from "back-end/src/validators/openapi";
import { PostSafeRolloutSnapshotResponse } from "back-end/types/openapi";

// TODO update params (add phase, useCache)
export const postSafeRolloutSnapshot = createApiRequestHandler(
  postSafeRolloutSnapshotValidator
)(
  async (req): Promise<PostSafeRolloutSnapshotResponse> => {
    const context = req.context;
    const id = req.params.id;

    const safeRollout = await context.models.safeRollout.getById(id);

    if (!safeRollout) {
      throw new Error("Safe Rollout not found");
    }
    if (!safeRollout.datasource) {
      throw new Error("No datasource set for safe rollout");
    }

    const datasource = await getDataSourceById(context, safeRollout.datasource);
    if (!datasource) {
      throw new Error(
        `Could not find datasource for this safe rollout (datasource id: ${safeRollout.datasource})`
      );
    }

    // TODO permissions check?

    if (safeRollout.status === "draft") {
      throw new Error(`Safe Rollout is in draft state.`);
    }

    // This is doing an expensive analytics SQL query, so may take a long time
    // Set timeout to 30 minutes
    req.setTimeout(SNAPSHOT_TIMEOUT);

    const { snapshot } = await createSafeRolloutSnapshot({
      context,
      safeRollout,
      useCache: true,
    });


    // TODO audit event for safe rollout refresh?

    return {
      safeRolloutSnapshot: {
        id: snapshot.id,
        safeRolloutId: snapshot.safeRolloutId,
        status: snapshot.status,
      },
    };
  }
);
