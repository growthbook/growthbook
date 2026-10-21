import {
  ExperimentSnapshotTraffic,
  ExperimentSnapshotTrafficDimension,
} from "shared/types/experiment-snapshot";
import { ExperimentReportVariation } from "shared/types/report";
import { useEffect, useMemo, useState } from "react";
import { getValidDate } from "shared/dates";
import { FaCircle } from "react-icons/fa6";
import { parseISO } from "date-fns";
import { SegmentedControl } from "@radix-ui/themes";
import { DEFAULT_SRM_THRESHOLD } from "shared/constants";
import Switch from "@/ui/Switch";
import { useUser } from "@/services/UserContext";
import track from "@/services/track";
import { formatTrafficSplit } from "@/services/utils";
import { formatNumber } from "@/services/metrics";
import ExperimentDateGraph, {
  ExperimentDateGraphDataPoint,
} from "@/components/Experiment/ExperimentDateGraph";
import { getUnitDisplayName } from "@/services/experiments";
import SelectField from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import VariationLabel from "@/ui/VariationLabel";
import Callout from "@/ui/Callout";
import { transformDimensionData } from "./DimensionIssues";

const numberFormatter = new Intl.NumberFormat();

function compareDimsByTotalUsers(
  dim1: ExperimentSnapshotTrafficDimension,
  dim2: ExperimentSnapshotTrafficDimension,
) {
  const sum1 = dim1.variationUnits.reduce((acc, num) => acc + num, 0);
  const sum2 = dim2.variationUnits.reduce((acc, num) => acc + num, 0);

  // Compare the sums
  return sum2 - sum1;
}

export default function TrafficCard({
  traffic,
  variations,
  isBandit,
  disableDimensions,
  cardTitle = "Traffic",
  containerClassName = "box p-3 my-4",
  cluster,
}: {
  traffic: ExperimentSnapshotTraffic;
  variations: ExperimentReportVariation[];
  isBandit: boolean;
  disableDimensions?: boolean;
  cardTitle?: string;
  containerClassName?: string;
  cluster?: {
    identifier: string;
    subUnitIdentifier: string;
    traffic?: ExperimentSnapshotTraffic;
  };
}) {
  const [cumulative, setCumulative] = useState(true);
  const [showClusters, setShowClusters] = useState(false);
  const clusterTrafficMissing = showClusters && !cluster?.traffic;
  const unitTraffic =
    showClusters && cluster?.traffic ? cluster.traffic : traffic;
  const { settings } = useUser();

  const srmThreshold = settings.srmThreshold ?? DEFAULT_SRM_THRESHOLD;

  const trafficByDate = useMemo(
    () => unitTraffic.dimension?.dim_exposure_date || [],
    [unitTraffic],
  );

  const availableDimensions = useMemo(
    () =>
      disableDimensions
        ? []
        : transformDimensionData(
            unitTraffic.dimension,
            variations,
            srmThreshold,
            isBandit,
          ),
    [disableDimensions, unitTraffic, variations, srmThreshold, isBandit],
  );

  const [selectedDimension, setSelectedDimension] = useState<string>("");

  const dimensionWithIssues = availableDimensions.find(
    (d) => d.value === selectedDimension,
  );

  useEffect(() => {
    // Reset selected dimension if traffic changes and dimension is no longer available
    if (!availableDimensions.find((d) => d.value === selectedDimension))
      setSelectedDimension("");
  }, [availableDimensions, selectedDimension, unitTraffic]);

  // Get data for users graph
  const usersPerDate = useMemo<ExperimentDateGraphDataPoint[]>(() => {
    // Keep track of total users per variation for when cumulative is true
    const total: number[] = [];
    const sortedTraffic = [...trafficByDate].sort((a, b) => {
      return getValidDate(a.name).getTime() - getValidDate(b.name).getTime();
    });

    return sortedTraffic.map((d) => {
      return {
        d: getValidDate(parseISO(d.name)),
        variations: variations.map((variation, i) => {
          const users = d.variationUnits[i] || 0;
          total[i] = total[i] || 0;
          total[i] += users;
          const v = cumulative ? total[i] : users;
          const v_formatted = v + "";
          return {
            v,
            v_formatted,
            label: numberFormatter.format(v),
          };
        }),
        srm: d.srm,
      };
    });
  }, [trafficByDate, variations, cumulative]);

  const sortedDimensionSlices = useMemo(() => {
    return unitTraffic.dimension?.[selectedDimension]?.sort(
      compareDimsByTotalUsers,
    );
  }, [selectedDimension, unitTraffic.dimension]);

  return (
    <div className={containerClassName}>
      <div className="mx-2">
        {!disableDimensions && (
          <div className="d-flex flex-row mt-1">
            <h2 className="d-inline">{cardTitle}</h2>
            <div className="flex-1" />
            {cluster && (
              <div className="col-auto">
                <div className="uppercase-title text-muted">Unit</div>
                <SegmentedControl.Root
                  size="1"
                  value={showClusters ? "cluster" : "subunit"}
                  onValueChange={(v) => setShowClusters(v === "cluster")}
                  aria-label="Unit"
                >
                  <SegmentedControl.Item value="cluster">
                    {getUnitDisplayName(cluster.identifier)}
                  </SegmentedControl.Item>
                  <SegmentedControl.Item value="subunit">
                    {getUnitDisplayName(cluster.subUnitIdentifier)}
                  </SegmentedControl.Item>
                </SegmentedControl.Root>
              </div>
            )}
            <div className="col-auto">
              <div className="uppercase-title text-muted">Dimension</div>
              <SelectField
                size="legacy"
                containerClassName={"select-dropdown-underline"}
                initialOption="Over Time"
                options={availableDimensions}
                value={selectedDimension}
                onChange={(v) => {
                  if (v === selectedDimension) return;
                  track("Select health tab traffic card dimension");
                  setSelectedDimension(v);
                }}
                disabled={!availableDimensions.length}
              />
            </div>
          </div>
        )}

        <div className="mt-3 mb-3 d-flex align-items-center">
          <h3>
            {selectedDimension
              ? `Experiment Traffic by ${
                  dimensionWithIssues?.label ?? "Dimension"
                }`
              : "Experiment Traffic Over Time"}
          </h3>
          {!selectedDimension && (
            <div className="ml-auto">
              Cumulative <Switch value={cumulative} onChange={setCumulative} />
            </div>
          )}
        </div>
      </div>
      {clusterTrafficMissing ? (
        <Callout status="info" mx="2" mb="2">
          Traffic per <code>{cluster?.identifier}</code> isn&apos;t available
          for this experiment yet.
        </Callout>
      ) : selectedDimension ? (
        <table className="table w-auto" style={{ minWidth: "70%" }}>
          <thead>
            <tr>
              <th className="border-top-0" style={{ paddingLeft: "32px" }}>
                {dimensionWithIssues?.label}
              </th>
              {variations.map((v) => (
                <th className="border-top-0" key={v.id}>
                  <VariationLabel number={v.index} name={v.name} size="md" />
                </th>
              ))}
              <th className="border-top-0">Expected %</th>
              <th className="border-top-0">Actual %</th>
            </tr>
          </thead>
          <tbody>
            {(sortedDimensionSlices || []).map((r, i) => {
              const showWarning = !!dimensionWithIssues?.issues.find(
                (i) => i === r.name,
              );
              return (
                <tr key={i}>
                  <td className="border-right">
                    {!isBandit ? (
                      <>
                        <Tooltip
                          body={
                            showWarning
                              ? "Issues detected"
                              : "No issues detected"
                          }
                          tipPosition="top"
                        >
                          <FaCircle
                            style={{
                              width: "6px",
                              height: "6px",
                              margin: "7px",
                              color: showWarning ? "#FFC107" : "#E8EBEF",
                            }}
                          />{" "}
                        </Tooltip>
                        <a
                          href="#balanceCheck"
                          onClick={(e) => e.preventDefault}
                        >
                          {r.name}
                        </a>
                      </>
                    ) : (
                      r.name
                    )}
                  </td>
                  {variations.map((_v, i) => (
                    <td style={{ paddingLeft: "35px" }} key={i}>
                      {numberFormatter.format(r.variationUnits[i] || 0)}
                    </td>
                  ))}
                  <td className="border-left">
                    {formatTrafficSplit(
                      variations.map((v) => v.weight),
                      1,
                    )}
                  </td>
                  <td>
                    <b>
                      {formatTrafficSplit(
                        variations.map((v, i) => r.variationUnits[i] || 0),
                        1,
                      )}
                    </b>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="mt-2 mb-2">
          <ExperimentDateGraph
            yaxis="users"
            variations={variations}
            label="Units"
            datapoints={usersPerDate}
            formatter={formatNumber}
            cumulative={cumulative}
          />
        </div>
      )}
    </div>
  );
}
