import { RampScheduleInterface } from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";

/**
 * Gate the monitoring-refresh paths BEFORE their lazy `ensureSafeRolloutForMonitoredRamp`
 * write. Refreshing is a query, so the authority is the datasource's — but the
 * JIT ensure creates a monitoring experiment and links it to the schedule, and
 * an under-privileged caller must not reach a write on the way to its 403.
 *
 * The datasource is whatever an existing SafeRollout names, else the schedule's
 * monitoring config. When neither resolves there is nothing to authorize against
 * and the caller's own 409/400 for unconfigured monitoring stands; the callers
 * re-check authoritatively after the ensure, since the SafeRollout it creates can
 * name a different datasource.
 */
export async function assertCanRefreshRampMonitoring(
  context: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  existing: { datasourceId?: string } | null,
): Promise<void> {
  const datasourceId =
    existing?.datasourceId ?? schedule.monitoringConfig?.datasourceId;
  if (!datasourceId) return;
  const datasource = await getDataSourceById(context, datasourceId);
  if (!datasource) return;
  if (!context.permissions.canCreateExperimentSnapshot(datasource)) {
    context.permissions.throwPermissionError();
  }
}
