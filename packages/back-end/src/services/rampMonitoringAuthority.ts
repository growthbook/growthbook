import { RampScheduleInterface } from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";

// Gate the monitoring-refresh paths BEFORE their lazy `ensureSafeRolloutForMonitoredRamp`
// write. Refreshing is a query, so the authority is the datasource's — but the
// JIT ensure creates a monitoring experiment and links it to the schedule, and
// an under-privileged caller must not reach a write on the way to its 403.
//
// The datasource is whatever an existing SafeRollout names, else the schedule's
// monitoring config. When neither resolves the schedule has no monitoring configured
// at all, the ensure bails on its own, and the caller's 409 stands; the callers
// re-check authoritatively after the ensure, since the SafeRollout it creates can
// name a different datasource.
export async function assertCanRefreshRampMonitoring(
  context: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  existing: { datasourceId?: string } | null,
): Promise<void> {
  const datasourceId =
    existing?.datasourceId ?? schedule.monitoringConfig?.datasourceId;
  if (!datasourceId) return;
  const datasource = await getDataSourceById(context, datasourceId);
  // A dangling reference must not pass: there is nothing to authorize against,
  // and returning here would let the ensure write before the caller's own
  // "datasource not found" fired — the very ordering this function exists to fix.
  if (!datasource) {
    throw new Error(`Datasource "${datasourceId}" not found.`);
  }
  if (!context.permissions.canCreateExperimentSnapshot(datasource)) {
    context.permissions.throwPermissionError();
  }
}
