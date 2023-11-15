import { ExperimentSnapshotTraffic } from "back-end/types/experiment-snapshot";
import { ExperimentReportVariation } from "back-end/types/report";
import { useState } from "react";
import { useUser } from "@/services/UserContext";
import VariationUsersTable from "../Experiment/TabbedPage/VariationUsersTable";
import SRMWarning, { SRM_THRESHOLD } from "../Experiment/SRMWarning";
import SelectField, { SingleValue } from "../Forms/SelectField";
import { DataPointVariation } from "../Experiment/ExperimentDateGraph";
import HealthDrawer, { HealthStatus } from "./HealthDrawer";

interface Props {
  traffic: ExperimentSnapshotTraffic;
  variations: ExperimentReportVariation[];
  totalUsers: number;
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
      <b>P-Value:</b> {parseFloat(srm.toFixed(8))}
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

export default function SRMDrawer({ traffic, variations, totalUsers }: Props) {
  const [selectedDimension, setSelectedDimension] = useState<string>("");
  const { settings } = useUser();

  const srmThreshold = settings.srmThreshold ?? SRM_THRESHOLD;

  // Skip checks if experiment phase has extremely uneven weights
  // This causes too many false positives with the current data quality checks
  const skipSrmCheck = variations.filter((x) => x.weight < 0.02).length > 0;
  const overallHealth = skipSrmCheck
    ? "unknown"
    : srmHealthCheck({
        srm: traffic.overall[0].srm,
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
    return [...filtered, { label: dim.replace("dim_exp_", ""), value: dim }];
  }, []);

  const areDimensionsAvailable = !!availableDimensions.length;

  return (
    <HealthDrawer
      title="Experiment Balance Check"
      status={overallHealth}
      tooltipBody={renderTooltipBody({
        srm: traffic.overall[0].srm,
        health: overallHealth,
        wasSrmCheckSkipped: skipSrmCheck,
      })}
    >
      <div className="mt-4">
        {!areDimensionsAvailable && (
          <div className="alert alert-warning">
            It looks like you haven&apos;t selected any dimensions to use for
            traffic within your datasource&apos;s experiment assignment query.
            If you&apos;d like to be able to view traffic breakdown by
            dimension, please edit your experiment assignment query and add the
            dimensions you&apos;d like to support under `Dimensions for Traffic`
          </div>
        )}
        <div className="row justify-content-between mb-2">
          <VariationUsersTable
            users={traffic.overall[0].variationUnits}
            variations={variations}
            srm={traffic.overall[0].srm}
          />
          <div className="col-sm ml-4 mr-4">
            {overallHealth === "healthy" && (
              <div className="alert alert-info">{HEALTHY_TOOLTIP_MESSAGE}</div>
            )}
            {overallHealth === "unhealthy" && (
              <SRMWarning
                srm={traffic.overall[0].srm}
                expected={variations.map((v) => v.weight)}
                observed={traffic.overall[0].variationUnits}
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
          <div className="col-auto mr-5">
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
        </div>
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
                  key={d.name}
                  tooltipBody={renderTooltipBody({
                    srm: d.srm,
                    health: dimensionHealth,
                  })}
                >
                  <div className="mt-4">
                    <div className="row justify-content-between mb-2">
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
    </HealthDrawer>
  );
}
