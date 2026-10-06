import { ExposureQuery } from "shared/types/datasource";
import type { ApiAssignmentQueryRefInput } from "../validators/assignment-query-field";
import type {
  ApiRampMonitoringConfig,
  RampMonitoringConfig,
} from "../validators/ramp-schedule";
import {
  AssignmentQuerySelection,
  flattenExposureQueryInput,
  toApiAssignmentQueryRef,
} from "./exposure-queries";

/**
 * Ramps and ramp templates store their assignment selection flat, nested in
 * the monitoring config.
 */
export function toMonitoringSelection(
  mc: Pick<
    RampMonitoringConfig,
    "datasourceId" | "exposureQueryId" | "exposureQueryIdentifierType"
  >,
): AssignmentQuerySelection {
  return {
    datasource: mc.datasourceId,
    exposureQueryId: mc.exposureQueryId,
    identifierType: mc.exposureQueryIdentifierType,
  };
}

/**
 * The API's grouped `exposureQuery` supersedes the deprecated
 * `exposureQueryId`; the stored config stays flat.
 */
export function apiMonitoringConfigToInternal<
  T extends {
    datasourceId: string;
    exposureQuery?: ApiAssignmentQueryRefInput;
    exposureQueryId?: string;
  },
>(
  mc: T,
  previous?: Pick<
    RampMonitoringConfig,
    "datasourceId" | "exposureQueryId" | "exposureQueryIdentifierType"
  > | null,
) {
  const { exposureQueryId, ...flat } = flattenExposureQueryInput(mc);
  if (!exposureQueryId) {
    throw new Error("monitoringConfig.exposureQuery is required");
  }
  /**
   * The config is replaced whole, so re-sending the same query without an
   * identifier would otherwise drop the stored one for the legacy default.
   */
  const keepsIdentifier =
    !flat.exposureQueryIdentifierType &&
    !!previous?.exposureQueryIdentifierType &&
    previous.datasourceId === mc.datasourceId &&
    previous.exposureQueryId === exposureQueryId;
  return {
    ...flat,
    exposureQueryId,
    ...(keepsIdentifier
      ? { exposureQueryIdentifierType: previous.exposureQueryIdentifierType }
      : {}),
  };
}

export function monitoringConfigToApi(
  mc: RampMonitoringConfig,
  exposureQueries: Pick<ExposureQuery, "id" | "userIdType" | "userIdTypes">[],
): ApiRampMonitoringConfig {
  const { exposureQueryIdentifierType, ...rest } = mc;
  return {
    ...rest,
    exposureQuery: toApiAssignmentQueryRef(
      rest.exposureQueryId,
      exposureQueryIdentifierType,
      exposureQueries,
    ),
  };
}
