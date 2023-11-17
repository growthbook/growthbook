import { ExperimentSnapshotTraffic } from "back-end/types/experiment-snapshot";
import { ExperimentReportVariation } from "back-end/types/report";
import { useState } from "react";
import Link from "next/link";
import { useUser } from "@/services/UserContext";
import { pValueFormatter } from "@/services/experiments";
import { DEFAULT_SRM_THRESHOLD } from "@/pages/settings";
import VariationUsersTable from "../Experiment/TabbedPage/VariationUsersTable";
import SRMWarning from "../Experiment/SRMWarning";
import SelectField, { SingleValue } from "../Forms/SelectField";
import { DataPointVariation } from "../Experiment/ExperimentDateGraph";
import HealthDrawer, { HealthStatus } from "./HealthDrawer";

interface Props {
  traffic: ExperimentSnapshotTraffic;
  variations: ExperimentReportVariation[];
  totalUsers: number;
  datasource: string;
}

export const srmHealthCheck = ({
  srm,
  variations,
  srmThreshold,
  totalUsers,
}: {
  srm: number;
  variations: ExperimentReportVariation[] | DataPointVariation[];
  srmThreshold: number;
  totalUsers: number;
}): HealthStatus => {
  if (totalUsers && totalUsers < 8 * variations.length) {
    return "unknown";
  }

  if (srm >= srmThreshold) {
    return "healthy";
  }

  return "unhealthy";
};

const EXPERIMENT_DIMENSION_PREFIX = "dim_exp_";

const HEALTHY_TOOLTIP_MESSAGE =
  "Unit counts per variation are as expected. No imbalances detected.";

const UNHEALTHY_TOOLTIP_MESSAGE =
  "Sample Ratio Mismatch detected. Click into the drawer to investigate.";

const NOT_ENOUGH_DATA_TOOLTIP_MESSAGE =
  "Not enough data is available to detect a Sample Ratio Mismatch. Please come back later to check in on the experiment's balance.";

const SRM_CHECK_SKIPPED_TOOLTIP_MESSAGE =
  "This experiment's variations have extremely uneven weights. The SRM check has been skipped to avoid false positives";

const renderTooltipBody = ({
  srm,
  health,
  wasSrmCheckSkipped = false,
}: {
  srm: number;
  health: HealthStatus;
  wasSrmCheckSkipped?: boolean;
}) => {
  return (
    <div>
      <b>P-Value:</b> {pValueFormatter(srm)}
      {health === "healthy" && <div>{HEALTHY_TOOLTIP_MESSAGE}</div>}
      {health === "unhealthy" && <div>{UNHEALTHY_TOOLTIP_MESSAGE}</div>}
      {health === "unknown" && (
        <div>
          {wasSrmCheckSkipped
            ? SRM_CHECK_SKIPPED_TOOLTIP_MESSAGE
            : NOT_ENOUGH_DATA_TOOLTIP_MESSAGE}
        </div>
      )}
    </div>
  );
};

export default function SRMDrawer({
  traffic,
  variations,
  totalUsers,
  datasource,
}: Props) {
  const [selectedDimension, setSelectedDimension] = useState<string>("");
  const { settings } = useUser();

  console.log({ datasource });

  const srmThreshold = settings.srmThreshold ?? DEFAULT_SRM_THRESHOLD;

  // Skip checks if experiment phase has extremely uneven weights
  // This causes too many false positives with the current data quality checks
  const skipSrmCheck = variations.filter((x) => x.weight < 0.02).length > 0;
  const overallHealth = skipSrmCheck
    ? "unknown"
    : srmHealthCheck({
        srm: traffic.overall.srm,
        srmThreshold,
        variations,
        totalUsers,
      });

  const availableDimensions: SingleValue[] = Object.keys(
    traffic.dimension
  ).reduce((filtered, dim) => {
    if (dim === "dim_exposure_date") {
      return filtered;
    }
    return [
      ...filtered,
      { label: dim.replace(EXPERIMENT_DIMENSION_PREFIX, ""), value: dim },
    ];
  }, []);

  const areDimensionsAvailable = !!availableDimensions.length;

  return (
    <HealthDrawer
      title="Experiment Balance Check"
      status={overallHealth}
      tooltipBody={renderTooltipBody({
        srm: traffic.overall.srm,
        health: overallHealth,
        wasSrmCheckSkipped: skipSrmCheck,
      })}
    >
      <div className="mt-4">
        <div className="row justify-content-start mb-2">
          <VariationUsersTable
            users={traffic.overall.variationUnits}
            variations={variations}
            srm={traffic.overall.srm}
          />
          <div className="col-4 ml-4 mr-2">
            {overallHealth === "healthy" && (
              <div className="alert alert-info">{HEALTHY_TOOLTIP_MESSAGE}</div>
            )}
            {overallHealth === "unhealthy" && (
              <SRMWarning
                srm={traffic.overall.srm}
                expected={variations.map((v) => v.weight)}
                observed={traffic.overall.variationUnits}
              />
            )}
            {overallHealth === "unknown" && (
              <div className="alert alert-info">
                {skipSrmCheck
                  ? SRM_CHECK_SKIPPED_TOOLTIP_MESSAGE
                  : NOT_ENOUGH_DATA_TOOLTIP_MESSAGE}
              </div>
            )}
          </div>
        </div>
        <hr />
        <div className="row mt-4 mb-2">
          <div className="col-2 ml-2 mr-2">
            <div className="uppercase-title text-muted">Dimension</div>
            <SelectField
              containerClassName={"select-dropdown-underline"}
              options={availableDimensions}
              initialOption="None"
              value={selectedDimension}
              onChange={(v) => {
                if (v === selectedDimension) return;
                setSelectedDimension(v);
              }}
              helpText={"Break down traffic by dimension"}
              disabled={!areDimensionsAvailable}
            />
          </div>
          <div className="col-lg mr-5">
            {!areDimensionsAvailable && (
              <div className="alert alert-warning">
                It looks like you haven&apos;t selected any dimensions to use
                for traffic within your{" "}
                <Link href={`/datasources/${datasource}`}>
                  datasource&apos;s
                </Link>{" "}
                experiment assignment query. If you&apos;d like to be able to
                view traffic breakdown by dimension, please edit your experiment
                assignment query and add the dimensions you&apos;d like to
                support under <b>Dimensions to use in traffic breakdowns</b>
              </div>
            )}
            {selectedDimension && (
              <div className="ml-4">
                {traffic.dimension[selectedDimension].map((d) => {
                  const totalDimUsers = d.variationUnits.reduce(
                    (acc, a) => acc + a,
                    0
                  );
                  const dimensionHealth = srmHealthCheck({
                    srm: d.srm,
                    srmThreshold,
                    variations,
                    totalUsers: totalDimUsers,
                  });
                  return (
                    <HealthDrawer
                      title={d.name}
                      status={dimensionHealth}
                      statusAlign="right"
                      key={d.name}
                      tooltipBody={renderTooltipBody({
                        srm: d.srm,
                        health: dimensionHealth,
                      })}
                    >
                      <div className="mt-4">
                        <div className="row justify-content-start mb-2">
                          <VariationUsersTable
                            users={d.variationUnits}
                            variations={variations}
                            srm={d.srm}
                          />
                          <div className="col-sm ml-4 mr-4">
                            {overallHealth === "unhealthy" && (
                              <SRMWarning
                                srm={d.srm}
                                expected={variations.map((v) => v.weight)}
                                observed={d.variationUnits}
                              />
                            )}
                          </div>
                        </div>
                      </div>
                    </HealthDrawer>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </HealthDrawer>
  );
}
