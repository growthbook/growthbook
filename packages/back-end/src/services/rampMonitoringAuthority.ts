import { RampScheduleInterface } from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";

// Authorize before lazy monitoring setup can write; callers recheck afterward.
export async function assertCanRefreshRampMonitoring(
  context: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  existing: { datasourceId?: string } | null,
): Promise<void> {
  const datasourceId =
    existing?.datasourceId ?? schedule.monitoringConfig?.datasourceId;
  if (!datasourceId) return;
  const datasource = await getDataSourceById(context, datasourceId);
  // Dangling references fail closed before lazy setup writes.
  if (!datasource) {
    throw new Error(`Datasource "${datasourceId}" not found.`);
  }
  if (!context.permissions.canCreateExperimentSnapshot(datasource)) {
    context.permissions.throwPermissionError();
  }
}
