import { ExperimentSnapshotTraffic } from "shared/types/experiment-snapshot";
import { ExperimentReportVariation } from "shared/types/report";
import { DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION } from "shared/constants";
import {
  DataSourceInterfaceWithParams,
  ExposureQuery,
} from "shared/types/datasource";
import clsx from "clsx";
import { Box } from "@radix-ui/themes";
import VariationUsersTable from "@/components/Experiment/TabbedPage/VariationUsersTable";
import { HealthTabConfigParams } from "@/components/Experiment/TabbedPage/HealthTabOnboardingModal";
import Callout from "@/ui/Callout";
import { StatusBadge } from "./StatusBadge";
import { DimensionIssues } from "./DimensionIssues";
import { IssueValue } from "./IssueTags";
import { SRMWarningFooter, useSrmHealth } from "./SRMCardShell";

interface Props {
  traffic: ExperimentSnapshotTraffic;
  variations: ExperimentReportVariation[];
  totalUsers: number;
  onNotify?: (issue: IssueValue) => void;
  snapshotId?: string;
  dataSource: DataSourceInterfaceWithParams | null;
  exposureQuery?: ExposureQuery;
  healthTabConfigParams?: HealthTabConfigParams;
  canConfigHealthTab: boolean;
  newDesign?: boolean;
  hideDimensions?: boolean;
}

export const EXPERIMENT_DIMENSION_PREFIX = "dim_exp_";

// NB: If this is for a Bandit experiment, we should use BanditSRMCard
export default function SRMCard({
  traffic,
  variations,
  totalUsers,
  onNotify,
  snapshotId,
  dataSource,
  exposureQuery,
  healthTabConfigParams,
  canConfigHealthTab,
  newDesign = false,
  hideDimensions = false,
}: Props) {
  const srmHealth = useSrmHealth({
    srm: traffic.overall.srm,
    numOfVariations: variations.length,
    totalUsersCount: totalUsers,
    minUsersPerVariation: DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
    onNotify,
    snapshotId,
  });

  if (!traffic?.overall?.variationUnits?.length) {
    return (
      <div className="appbox my-4 p-3">
        <Callout status="error">Traffic data is missing</Callout>
      </div>
    );
  }

  const classes = !newDesign ? "appbox container-fluid my-4 pl-3 py-3" : "";

  return (
    <div
      className={classes}
      style={{
        ...(newDesign && {
          border: "1px solid var(--slate-a4)",
          borderRadius: "var(--radius-1)",
          padding: "var(--space-4) var(--space-3) 0",
        }),
      }}
    >
      <div className={clsx("overflow-hidden", { row: !hideDimensions })}>
        <div className={clsx({ "col-8 border-right pr-4": !hideDimensions })}>
          <h2 className="d-inline">Experiment Balance Check</h2>{" "}
          {srmHealth !== "healthy" && <StatusBadge status={srmHealth} />}
          <p className="mt-1">
            Shows actual unit split compared to percent selected for the
            experiment
          </p>
          <hr className="mb-0"></hr>
          <div style={{ paddingTop: "10px" }}>
            <VariationUsersTable
              users={traffic.overall.variationUnits}
              variations={variations}
              srm={traffic.overall.srm}
            />
            <Box mt="3">
              <SRMWarningFooter
                srm={traffic.overall.srm}
                srmHealth={srmHealth}
                variations={variations}
                users={traffic.overall.variationUnits}
                isBandit={false}
              />
            </Box>
          </div>
        </div>
        {!hideDimensions && (
          // Out of the flow, so the balance check alone sets the row's height
          // and a long dimension list scrolls within it.
          <Box className="col" p="0" position="relative">
            <Box position="absolute" inset="0" overflow="hidden">
              <DimensionIssues
                dimensionData={traffic.dimension}
                variations={variations}
                dataSource={dataSource}
                exposureQuery={exposureQuery}
                healthTabConfigParams={healthTabConfigParams}
                canConfigHealthTab={canConfigHealthTab}
                isBandit={false}
              />
            </Box>
          </Box>
        )}
      </div>
    </div>
  );
}
