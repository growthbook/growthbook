import {
  ExperimentInterfaceExcludingHoldouts,
  postExperimentChangesValidator,
} from "shared/validators";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { toExperimentApiInterface } from "back-end/src/services/experiments";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { makeExperimentChanges } from "back-end/src/services/experimentChanges/makeChanges/makeChanges";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { markDryRunError, NotFoundError } from "back-end/src/util/errors";

export const postExperimentChanges = createApiRequestHandler(
  postExperimentChangesValidator,
)(async (req) => {
  const { body } = req;
  const dryRun = !!body.dryRun;
  try {
    const experiment = await getExperimentById(req.context, req.params.id);
    if (!experiment) {
      throw new NotFoundError("Could not find the experiment to change");
    }

    const result = await makeExperimentChanges(req.context, experiment, body);

    if (!dryRun) {
      await req.audit({
        event: "experiment.update",
        entity: { object: "experiment", id: experiment.id },
        ...(body.reason ? { reason: body.reason } : {}),
        details: auditDetailsUpdate(experiment, result.experiment, {
          makeChanges: {
            changeType: body.changeType,
            releasePlan: result.releasePlan,
          },
        }),
      });
    }

    return {
      dryRun,
      assessment: result.assessment,
      experiment: await resolveOwnerEmail(
        await toExperimentApiInterface(
          req.context,
          result.experiment as ExperimentInterfaceExcludingHoldouts,
        ),
        req.context,
      ),
    };
  } catch (e) {
    if (dryRun) markDryRunError(e);
    throw e;
  }
});
