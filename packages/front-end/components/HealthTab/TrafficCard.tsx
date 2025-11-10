import {
  ExperimentSnapshotTraffic,
  ExperimentSnapshotTrafficDimension,
} from "back-end/types/experiment-snapshot";
import { ExperimentReportVariation } from "back-end/types/report";
import { useEffect, useMemo, useState } from "react";
import { getValidDate } from "shared/dates";
import { FaCircle } from "react-icons/fa6";
import { parseISO } from "date-fns";
import { DEFAULT_SRM_THRESHOLD } from "shared/constants";
import Switch from "@/ui/Switch";
import { useUser } from "@/services/UserContext";
import track from "@/services/track";
import { formatTrafficSplit } from "@/services/utils";
import { formatNumber } from "@/services/metrics";
import ExperimentDateGraph, {
  ExperimentDateGraphDataPoint,
} from "@/components/Experiment/ExperimentDateGraph";
import SelectField from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
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
}: {
  traffic: ExperimentSnapshotTraffic;
  variations: ExperimentReportVariation[];
  isBandit: boolean;
  disableDimensions?: boolean;
  cardTitle?: string;
  containerClassName?: string;
}) {
  const [cumulative, setCumulative] = useState(true);
  const { settings } = useUser();

  const srmThreshold = settings.srmThreshold ?? DEFAULT_SRM_THRESHOLD;

  const trafficByDate = useMemo(
    () => traffic.dimension?.dim_exposure_date || [],
    [traffic],
  );

  const availableDimensions = useMemo(
    () =>
      disableDimensions
        ? []
        : transformDimensionData(
            traffic.dimension,
            variations,
            srmThreshold,
            isBandit,
          ),
    [disableDimensions, traffic, variations, srmThreshold, isBandit],
  );

  const [selectedDimension, setSelectedDimension] = useState<string>("");

  const dimensionWithIssues = availableDimensions.find(
    (d) => d.value === selectedDimension,
  );

  useEffect(() => {
    // Reset selected dimension if traffic changes and dimension is no longer available
    if (!availableDimensions.find((d) => d.value === selectedDimension))
      setSelectedDimension("");
  }, [availableDimensions, selectedDimension, traffic]);

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
    return traffic.dimension?.[selectedDimension]?.sort(
      compareDimsByTotalUsers,
    );
  }, [selectedDimension, traffic.dimension]);

  return (
    <div className={containerClassName}>
      <div className="mx-2">
        {!disableDimensions && (
          <div className="d-flex flex-row mt-1">
            <h2 className="d-inline">{cardTitle}</h2>
            <div className="flex-1" />
            <div className="col-auto">
              <div className="uppercase-title text-muted">Dimension</div>
              <SelectField
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
      {selectedDimension ? (
        <table className="table w-auto" style={{ minWidth: "70%" }}>
          <thead>
            <tr>
              <th className="border-top-0" style={{ paddingLeft: "32px" }}>
                {dimensionWithIssues?.label}
              </th>
              {variations.map((v, i) => (
                <th
                  className={`border-top-0 variation with-variation-label variation${i}`}
                  key={i}
                >
                  <span
                    className="label"
                    style={{
                      width: 20,
                      height: 20,
                    }}
                  >
                    {i}
                  </span>
                  {v.name}
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
            variationNames={variations.map((v) => v.name)}
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
