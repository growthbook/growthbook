import { ExperimentSnapshotTraffic } from "back-end/types/experiment-snapshot";
import { ExperimentReportVariation } from "back-end/types/report";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useUser } from "@/services/UserContext";
import { pValueFormatter } from "@/services/experiments";
import { DEFAULT_SRM_THRESHOLD } from "@/pages/settings";
import track from "@/services/track";
import VariationUsersTable from "../Experiment/TabbedPage/VariationUsersTable";
import SRMWarning from "../Experiment/SRMWarning";
import SelectField, { SingleValue } from "../Forms/SelectField";
import { DataPointVariation } from "../Experiment/ExperimentDateGraph";
import HealthCard from "./HealthCard";
import { HealthStatus } from "./StatusBadge";

interface Props {
  traffic: ExperimentSnapshotTraffic;
  variations: ExperimentReportVariation[];
  totalUsers: number;
  datasource: string;
  onNotify: () => void;
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
    return "Not enough traffic";
  } else if (srm >= srmThreshold) {
    return "healthy";
  }
  return "Issues detected";
};

const EXPERIMENT_DIMENSION_PREFIX = "dim_exp_";
const HEALTHY_TOOLTIP_MESSAGE =
  "Unit counts per variation are as expected. No imbalances detected.";
const NOT_ENOUGH_DATA_TOOLTIP_MESSAGE =
  "Not enough data to compute balance check.";

export default function SRMDrawer({
  traffic,
  variations,
  totalUsers,
  datasource,
  onNotify,
}: Props) {
  const [selectedDimension, setSelectedDimension] = useState<string>("");
  const { settings } = useUser();

  const srmThreshold = settings.srmThreshold ?? DEFAULT_SRM_THRESHOLD;

  const overallHealth: HealthStatus = srmHealthCheck({
    srm: traffic.overall.srm,
    srmThreshold,
    variations,
    totalUsers,
  });

  useEffect(() => {
    if (overallHealth === "Issues detected") {
      onNotify();
    }
  }, [overallHealth, onNotify]);

  useEffect(() => {
    setSelectedDimension("");
  }, [traffic]);

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
    <HealthCard
      title="Experiment Balance Check"
      helpText="Shows actual unit split compared to percent selected for the experiment"
      status={overallHealth}
    >
      <div className="mt-4">
        <div className="row justify-content-start mb-2">
          <VariationUsersTable
            users={traffic.overall.variationUnits}
            variations={variations}
            srm={pValueFormatter(traffic.overall.srm)}
            isUnhealthy={overallHealth === "Issues detected"}
          />
        </div>
        <div>
          {overallHealth === "healthy" && (
            <div className="alert alert-info">{HEALTHY_TOOLTIP_MESSAGE}</div>
          )}
          {overallHealth === "Issues detected" && (
            <SRMWarning
              srm={traffic.overall.srm}
              expected={variations.map((v) => v.weight)}
              observed={traffic.overall.variationUnits}
            />
          )}
          {overallHealth === "Not enough traffic" && (
            <div className="alert alert-info">
              {NOT_ENOUGH_DATA_TOOLTIP_MESSAGE}
            </div>
          )}
        </div>
        {/* <hr />
        <div className="mt-4 mb-2">
          <div className="mb-4" style={{ maxWidth: 300 }}>
            <div className="uppercase-title text-muted">Dimension</div>
            <SelectField
              containerClassName={"select-dropdown-underline"}
              options={availableDimensions}
              initialOption="None"
              value={selectedDimension}
              onChange={(v) => {
                if (v === selectedDimension) return;
                track("Select health tab dimension");
                setSelectedDimension(v);
              }}
              helpText={"Break down traffic by dimension"}
              disabled={!areDimensionsAvailable}
            />
          </div>
          {!areDimensionsAvailable && (
            <div className="alert alert-warning">
              No dimensions have been selected for automatic traffic checks. If
              you&apos;d like to be able to view traffic breakdown by dimension,
              go to your{" "}
              <Link href={`/datasources/${datasource}`}>datasource</Link> and
              follow the documentation{" "}
              <a href="https://docs.growthbook.io/app/experiment-results#adding-dimensions-to-health-tab">
                here
              </a>
              .
            </div>
          )}
          {selectedDimension && (
            <>
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
                  <HealthCard
                    title={d.name}
                    helpText={`(${totalDimUsers} total units)`}
                    status={dimensionHealth}
                    key={d.name}
                  >
                    <div className="mt-4">
                      <div className="row justify-content-start mb-2">
                        <VariationUsersTable
                          users={d.variationUnits}
                          variations={variations}
                          srm={pValueFormatter(d.srm)}
                          isUnhealthy={dimensionHealth === "Issues detected"}
                        />
                        <div className="col-sm ml-4 mr-4">
                          {overallHealth === "Issues detected" && (
                            <SRMWarning
                              srm={d.srm}
                              expected={variations.map((v) => v.weight)}
                              observed={d.variationUnits}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  </HealthCard>
                );
              })}
            </>
          )}
        </div> */}
      </div>
    </HealthCard>
  );
}
