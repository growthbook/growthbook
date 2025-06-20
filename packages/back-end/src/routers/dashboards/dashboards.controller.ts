import { getValidDate } from "shared/dates";
import { z } from "zod";
import { isMatch, uniq } from "lodash";
import { isPersistedDashboardBlock } from "shared/enterprise";
import {
  getAllMetricIdsFromExperiment,
  getAllMetricSettingsForSnapshot,
} from "shared/experiments";
import { isDefined } from "shared/util";
import {
  AuthRequest,
  ResponseWithStatusAndError,
} from "back-end/src/types/AuthRequest";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { getContextFromReq } from "back-end/src/services/organizations";
import {
  DashboardInstanceInterface,
  DashboardSettingsInterface,
  DashboardSettingsStringDates,
} from "back-end/src/enterprise/validators/dashboard-instance";
import { createDashboardBlock } from "back-end/src/enterprise/models/DashboardBlockModel";
import { computeSnapshotSettings } from "back-end/src/enterprise/models/DashboardInstanceModel";
import { getLatestSnapshot } from "back-end/src/models/ExperimentSnapshotModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import {
  createSnapshot,
  createSnapshotAnalyses,
} from "back-end/src/services/experiments";
import { getMetricMap } from "back-end/src/models/MetricModel";
import { MetricInterface } from "back-end/types/metric";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getFactTableMap } from "back-end/src/models/FactTableModel";
import { createDashboardBody, updateDashboardBody } from "./dashboards.router";

interface GetSnapshotsResponse {
  snapshots: Record<string, ExperimentSnapshotInterface>;
}

interface SingleDashboardResponse {
  status: number;
  dashboard: DashboardInstanceInterface;
}

export async function getSnapshotsForDashboard(
  req: AuthRequest<never, { id: string }, never>,
  res: ResponseWithStatusAndError<GetSnapshotsResponse>
) {
  const context = getContextFromReq(req);
  const { id } = req.params;
  const dashboard = await context.models.dashboards.getById(id);
  if (!dashboard) {
    return res.status(404).json({ status: 404, message: "Not Found" });
  }
  const experiment = await getExperimentById(context, dashboard.experimentId);
  if (!experiment) {
    return res.status(404).json({ status: 404, message: "Not Found" });
  }
  const snapshotSettingsInfo = await computeSnapshotSettings(
    dashboard,
    experiment
  );
  const snapshotsWithBlocks = await Promise.all(
    snapshotSettingsInfo.map(
      async ({
        snapshotSettings,
        analysisSettingsList,
        blockUids,
      }): Promise<[ExperimentSnapshotInterface, string[]]> => {
        const metricMap = await getMetricMap(context);
        let snapshot = await getLatestSnapshot({
          experiment: dashboard.experimentId,
          phase: experiment.phases.length - 1,
          dimension: snapshotSettings.dimensions[0]?.id,
        });
        if (snapshot) {
          // Create any necessary analyses that don't already exist on the snapshot
          const newAnalysisSettings = analysisSettingsList.filter(
            (analysisSettings) =>
              !snapshot!.analyses.find((analysis) =>
                isMatch(analysis.settings, analysisSettings)
              )
          );
          await createSnapshotAnalyses(
            newAnalysisSettings.map((analysisSettings) => ({
              experiment,
              organization: context.org,
              analysisSettings,
              metricMap,
              snapshot: snapshot!,
            })),
            context
          );
        } else {
          const metricIds = getAllMetricIdsFromExperiment(experiment, false);
          const allExperimentMetrics = metricIds.map(
            (m) => metricMap.get(m) || null
          );
          const denominatorMetricIds = uniq<string>(
            allExperimentMetrics
              .map((m) => m?.denominator)
              .filter((d) => d && typeof d === "string") as string[]
          );
          const denominatorMetrics = denominatorMetricIds
            .map((m) => metricMap.get(m) || null)
            .filter(isDefined) as MetricInterface[];
          const datasource = await getDataSourceById(
            context,
            experiment.datasource
          );
          const factTableMap = await getFactTableMap(context);

          const {
            settingsForSnapshotMetrics,
          } = getAllMetricSettingsForSnapshot({
            allExperimentMetrics,
            denominatorMetrics,
            orgSettings: context.org.settings!,
            experimentRegressionAdjustmentEnabled:
              experiment.regressionAdjustmentEnabled,
            experimentMetricOverrides: experiment.metricOverrides,
            datasourceType: datasource?.type,
            hasRegressionAdjustmentFeature: true,
          });

          const queryRunner = await createSnapshot({
            experiment,
            context,
            type: "report",
            triggeredBy: "manual",
            phaseIndex: experiment.phases.length - 1,
            defaultAnalysisSettings: analysisSettingsList[0],
            additionalAnalysisSettings: analysisSettingsList.slice(1),
            settingsForSnapshotMetrics,
            metricMap,
            factTableMap,
          });
          snapshot = queryRunner.model;
        }
        return [snapshot, blockUids];
      }
    )
  );
  const snapshots = Object.fromEntries(
    snapshotsWithBlocks.flatMap(([snapshot, blockUids]) =>
      blockUids.map((uid) => [uid, snapshot])
    )
  );

  return res.status(200).json({ status: 200, snapshots });
}

export async function createDashboard(
  req: AuthRequest<z.infer<typeof createDashboardBody>, never, never>,
  res: ResponseWithStatusAndError<SingleDashboardResponse>
) {
  const context = getContextFromReq(req);
  if (!context.hasPremiumFeature("dashboards")) {
    throw new Error("Must have a commercial License Key to create Dashboards");
  }

  const {
    experimentId,
    title,
    description,
    blocks,
    settings: userSettings,
  } = req.body;

  const settings = sanitizeUserSettings(userSettings);

  const createdBlocks = await Promise.all(
    blocks.map((blockData) => createDashboardBlock(context.org.id, blockData))
  );

  const dashboard = await context.models.dashboards.create({
    owner: context.userName,
    experimentId,
    title,
    description,
    blocks: createdBlocks,
    settings,
  });

  res.status(200).json({
    status: 200,
    dashboard,
  });
}

export async function updateDashboard(
  req: AuthRequest<z.infer<typeof updateDashboardBody>, { id: string }, never>,
  res: ResponseWithStatusAndError<SingleDashboardResponse>
) {
  const context = getContextFromReq(req);
  if (!context.hasPremiumFeature("dashboards")) {
    throw new Error("Must have a commercial License Key to manage Dashboards");
  }

  const { id } = req.params;
  const { title, description, blocks, settings } = req.body;

  const updates: Partial<DashboardInstanceInterface> = {
    title,
    description,
    settings: settings ? sanitizeUserSettings(settings) : undefined,
  };
  if (blocks) {
    const createdBlocks = await Promise.all(
      blocks.map((blockData) =>
        isPersistedDashboardBlock(blockData)
          ? blockData
          : createDashboardBlock(context.org.id, blockData)
      )
    );
    updates.blocks = createdBlocks;
  }

  const updatedDashboard = await context.models.dashboards.updateById(
    id,
    updates
  );

  res.status(200).json({
    status: 200,
    dashboard: updatedDashboard,
  });
}

export async function deleteDashboard(
  req: AuthRequest<never, { id: string }, never>,
  res: ResponseWithStatusAndError
) {
  const context = getContextFromReq(req);
  if (!context.hasPremiumFeature("dashboards")) {
    throw new Error("Must have a commercial License Key to manage Dashboards");
  }

  const { id } = req.params;
  await context.models.dashboards.deleteById(id);
  return res.status(200).json({ status: 200 });
}

function sanitizeUserSettings(
  userSettings: DashboardSettingsStringDates
): DashboardSettingsInterface {
  return {
    ...userSettings,
    dateStart: getValidDate(
      userSettings.dateStart,
      new Date(Date.now() - 30 * 1000 * 3600 * 24)
    ),
    dateEnd: getValidDate(userSettings.dateEnd, new Date()),
  };
}
