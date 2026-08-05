import { Request, RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { getExperimentBulkResultsValidator } from "shared/validators";
import { ApiRequestLocals } from "back-end/types/api";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { findSnapshotsByExperiment } from "back-end/src/models/ExperimentSnapshotModel";
import { getMetricMapForExperimentSnapshots } from "back-end/src/services/experiments";
import { toExperimentSnapshotBulkResultsApiInterface } from "back-end/src/api/experiments/bulkResultSerialization";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import {
  createApiRequestHandler,
  getPaginationReturnFields,
  validatePagination,
} from "back-end/src/util/handler";
import {
  EXPERIMENT_BULK_RESULTS_ENABLED,
  EXPERIMENT_BULK_RESULTS_RATE_LIMIT_MAX,
} from "back-end/src/util/secrets";

// Answer exactly like the router's unknown-endpoint handler when disabled, so
// a gated endpoint is indistinguishable from one that doesn't exist.
const requireBulkResultsEnabled: RequestHandler = (req, res, next) => {
  if (!EXPERIMENT_BULK_RESULTS_ENABLED) {
    return res.status(404).json({ message: "Unknown API endpoint" });
  }
  next();
};

// Stricter than the router-wide per-key cap: one page of this export hydrates
// every analysis on every snapshot it returns.
const bulkResultsRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: EXPERIMENT_BULK_RESULTS_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const { apiKey, organization } = req as Request & ApiRequestLocals;
    return apiKey || organization?.id || req.ip;
  },
  message: {
    message: `Too many requests, limit to ${EXPERIMENT_BULK_RESULTS_RATE_LIMIT_MAX} per minute`,
  },
});

export const getExperimentBulkResults = createApiRequestHandler({
  ...getExperimentBulkResultsValidator,
  middleware: [requireBulkResultsEnabled, bulkResultsRateLimit],
  // Undocumented while the endpoint is gated.
  excludeFromSpec: true,
})(async (req) => {
  const experiment = await getExperimentById(req.context, req.params.id);
  if (!experiment) {
    throw new NotFoundError("Could not find experiment with that id");
  }

  const dateStart = new Date(req.query.dateStart);
  const dateEnd = new Date(req.query.dateEnd);

  const phase =
    req.query.phase !== undefined && req.query.phase !== ""
      ? parseInt(req.query.phase, 10)
      : undefined;
  if (phase !== undefined && isNaN(phase)) {
    throw new BadRequestError("Invalid phase");
  }

  const { limit, offset } = validatePagination(req.query);

  const { snapshots, total } = await findSnapshotsByExperiment(req.context, {
    experiment: experiment.id,
    dateStart,
    dateEnd,
    phase,
    type: req.query.snapshotType,
    limit,
    offset,
  });

  // Resolve display names from metrics referenced by the returned snapshots,
  // including any since removed from the experiment but still in the org.
  const metricsById = await getMetricMapForExperimentSnapshots(
    req.context,
    experiment,
    snapshots,
  );

  // A single snapshot expands into one result item per dimension; pagination
  // stays over snapshots, so `count` reflects snapshots on this page.
  const results = snapshots.flatMap((snapshot) =>
    toExperimentSnapshotBulkResultsApiInterface(
      experiment,
      snapshot,
      metricsById,
    ),
  );

  return {
    results,
    ...getPaginationReturnFields(snapshots, total, { limit, offset }),
  };
});
