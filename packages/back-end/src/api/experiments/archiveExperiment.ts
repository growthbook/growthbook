import {
  deleteExperimentValidator,
  ExperimentInterfaceExcludingHoldouts,
  postExperimentArchiveValidator,
  postExperimentUnarchiveValidator,
} from "shared/validators";
import { PermissionError } from "shared/util";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { auditDetailsDelete } from "back-end/src/services/audit";
import {
  archiveExperimentWithCleanup,
  assertCanChangeServing,
  deleteExperimentWithCleanup,
  unarchiveExperimentWithCleanup,
} from "back-end/src/services/experimentRemoval";
import { canUseRestApiBypassSetting } from "back-end/src/api/features/reviewBypass";
import { toEnhancedExperimentApiResponse } from "./enhancedExperimentResponse";
import { requireExperiment } from "./requireExperiment";

export const postExperimentArchive = createApiRequestHandler(
  postExperimentArchiveValidator,
)(async (req) => {
  const experiment = await requireExperiment(req.context, req.params.id);
  if (!req.context.permissions.canUpdateExperiment(experiment, {})) {
    req.context.permissions.throwPermissionError();
  }
  await assertCanChangeServing(req.context, experiment);

  const updated = await archiveExperimentWithCleanup({
    context: req.context,
    experiment,
    linkedChanges: req.body.linkedChanges,
    eventAudit: req.eventAudit,
    audit: req.audit,
  });
  await req.audit({
    event: "experiment.archive",
    entity: { object: "experiment", id: experiment.id },
  });
  return {
    experiment: await toEnhancedExperimentApiResponse(
      req.context,
      updated as ExperimentInterfaceExcludingHoldouts,
    ),
  };
});

export const postExperimentUnarchive = createApiRequestHandler(
  postExperimentUnarchiveValidator,
)(async (req) => {
  const experiment = await requireExperiment(req.context, req.params.id);
  if (!req.context.permissions.canUpdateExperiment(experiment, {})) {
    req.context.permissions.throwPermissionError();
  }
  await assertCanChangeServing(req.context, experiment);
  const updated = await unarchiveExperimentWithCleanup({
    context: req.context,
    experiment,
  });
  await req.audit({
    event: "experiment.unarchive",
    entity: { object: "experiment", id: experiment.id },
  });
  return {
    experiment: await toEnhancedExperimentApiResponse(
      req.context,
      updated as ExperimentInterfaceExcludingHoldouts,
    ),
  };
});

export const deleteExperiment = createApiRequestHandler(
  deleteExperimentValidator,
)(async (req) => {
  const experiment = await requireExperiment(req.context, req.params.id);
  if (!req.context.permissions.canDeleteExperiment(experiment)) {
    req.context.permissions.throwPermissionError();
  }
  await assertCanChangeServing(req.context, experiment);
  // Same rule as Feature Flags: archive first, unless the org lets the REST
  // API act on live objects outright.
  if (!experiment.archived && !canUseRestApiBypassSetting(req)) {
    throw new PermissionError(
      "Cannot delete a live experiment via the REST API when 'REST API always bypasses approval requirements' is disabled. Archive the experiment first, or enable the bypass setting in organization settings.",
    );
  }

  await deleteExperimentWithCleanup({
    context: req.context,
    experiment,
    linkedChanges: req.query.linkedChanges,
    eventAudit: req.eventAudit,
    audit: req.audit,
  });
  await req.audit({
    event: "experiment.delete",
    entity: { object: "experiment", id: experiment.id },
    details: auditDetailsDelete(experiment),
  });
  return { deletedId: experiment.id };
});
