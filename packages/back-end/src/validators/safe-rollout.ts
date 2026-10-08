import { resolveAssignmentQuerySelectionChange } from "shared/util";
import {
  CreateSafeRolloutInterface,
  createSafeRolloutValidator,
  SafeRolloutInterface,
} from "shared/validators";
import { getMetricMap } from "back-end/src/models/MetricModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { BadRequestError } from "back-end/src/util/errors";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";

// This functions needs to stay in the back-end because it uses models, and can't be shared like the
// other validators in shared/validators.ts
export async function validateCreateSafeRolloutFields(
  safeRolloutFields: Partial<CreateSafeRolloutInterface> | undefined,
  context: ReqContext | ApiReqContext,
  /**
   * The stored rollout on update: an unchanged selection isn't re-validated.
   */
  previous?: Pick<
    SafeRolloutInterface,
    "datasourceId" | "exposureQueryId" | "exposureQueryIdentifierType"
  > | null,
  /** REST's grouped exposureQuery must name an identifier when ambiguous. */
  onOmitted: "defaultToFirst" | "requireUnambiguous" = "defaultToFirst",
): Promise<CreateSafeRolloutInterface> {
  // TODO: How to use Zod validator here and provide a good error message to the user?
  if (!safeRolloutFields) {
    throw new BadRequestError("Safe Rollout fields must be set");
  }
  if (
    safeRolloutFields?.maxDuration?.amount === undefined ||
    safeRolloutFields?.maxDuration?.amount < 1
  ) {
    throw new BadRequestError("Time to monitor must be at least 1 day");
  }
  if (safeRolloutFields.maxDuration.unit === undefined) {
    throw new BadRequestError(
      "Time to monitor must be specified for safe rollouts",
    );
  }
  if (safeRolloutFields.exposureQueryId === undefined) {
    throw new BadRequestError(
      "Exposure query must be specified for safe rollouts",
    );
  }
  if (safeRolloutFields.datasourceId === undefined) {
    throw new BadRequestError("Datasource must be specified for safe rollouts");
  }
  const datasource = await getDataSourceById(
    context,
    safeRolloutFields.datasourceId,
  );
  if (!datasource) {
    throw new BadRequestError(
      "Invalid datasource: " + safeRolloutFields.datasourceId,
    );
  }

  const resolved = resolveAssignmentQuerySelectionChange(
    datasource.settings?.queries?.exposure ?? [],
    {
      previous: previous
        ? {
            datasource: previous.datasourceId,
            exposureQueryId: previous.exposureQueryId,
            identifierType: previous.exposureQueryIdentifierType,
          }
        : null,
      next: {
        datasource: safeRolloutFields.datasourceId,
        exposureQueryId: safeRolloutFields.exposureQueryId,
        identifierType: safeRolloutFields.exposureQueryIdentifierType,
      },
      onOmitted,
      field: "exposureQuery",
    },
  );
  if (!resolved.ok) throw new BadRequestError(resolved.error);

  if (
    safeRolloutFields.guardrailMetricIds === undefined ||
    safeRolloutFields.guardrailMetricIds.length === 0
  ) {
    throw new BadRequestError("Please select at least 1 guardrail metric");
  }

  const metricIds = safeRolloutFields.guardrailMetricIds;
  const datasourceId = safeRolloutFields.datasourceId;
  if (metricIds.length) {
    const map = await getMetricMap(context);
    for (let i = 0; i < metricIds.length; i++) {
      const metric = map.get(metricIds[i]);
      if (metric) {
        if (datasourceId && metric.datasource !== datasourceId) {
          throw new BadRequestError(
            "Metrics must belong to the same datasource as the safe rollout: " +
              metricIds[i],
          );
        }
      } else {
        // check to see if this metric is actually a metric group
        const metricGroup = await context.models.metricGroups.getById(
          metricIds[i],
        );
        if (metricGroup) {
          // Make sure it is tied to the same datasource as the experiment
          if (datasourceId && metricGroup.datasource !== datasourceId) {
            throw new BadRequestError(
              "Metrics must be tied to the same datasource as the safe rollout: " +
                metricIds[i],
            );
          }
        } else {
          // new metric that's not recognized...
          throw new BadRequestError(
            "Invalid metric specified: " + metricIds[i],
          );
        }
      }
    }
  }

  // Always keyed: on update, undefined clears an identifier the new selection
  // doesn't use.
  return createSafeRolloutValidator.strip().parse({
    ...safeRolloutFields,
    exposureQueryIdentifierType: resolved.identifierType,
  });
}
