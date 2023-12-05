import { ExperimentSnapshotTraffic } from "back-end/types/experiment-snapshot";
import { ExperimentReportVariation } from "back-end/types/report";
import { useMemo, useState } from "react";
import { getValidDate } from "shared/dates";
import { useUser } from "@/services/UserContext";
import { DEFAULT_SRM_THRESHOLD } from "@/pages/settings";
import track from "@/services/track";
import { formatTrafficSplit } from "@/services/utils";
import ExperimentDateGraph, {
  ExperimentDateGraphDataPoint,
} from "../Experiment/ExperimentDateGraph";
import Toggle from "../Forms/Toggle";
import SelectField from "../Forms/SelectField";
import { transformDimensionData } from "./DimensionIssues";

const numberFormatter = new Intl.NumberFormat();

export default function TrafficCard({
  traffic,
  variations,
}: {
  traffic: ExperimentSnapshotTraffic;
  variations: ExperimentReportVariation[];
}) {
  const [cumulative, setCumulative] = useState(false);
  const { settings } = useUser();

  const srmThreshold = settings.srmThreshold ?? DEFAULT_SRM_THRESHOLD;

  const trafficByDate = traffic.dimension?.dim_exposure_date;

  const availableDimensions = transformDimensionData(
    traffic.dimension,
    variations,
    srmThreshold
  );
  const [selectedDimension, setSelectedDimension] = useState<string>("");

  // Get data for users graph
  const usersPerDate = useMemo<ExperimentDateGraphDataPoint[]>(() => {
    // Keep track of total users per variation for when cumulative is true
    const total: number[] = [];
    const sortedTraffic = [...trafficByDate];
    sortedTraffic.sort((a, b) => {
      return getValidDate(a.name).getTime() - getValidDate(b.name).getTime();
    });

    return sortedTraffic.map((d) => {
      return {
        d: getValidDate(d.name),
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

  return (
    <div className="appbox my-4 p-3">
      <div className="mx-2">
        <div className="d-flex flex-row mt-1">
          <h2 className="d-inline">{"Traffic"}</h2>
          <div className="col-2 ml-auto">
            <div className="uppercase-title text-muted">Dimension</div>
            <SelectField
              containerClassName={"select-dropdown-underline"}
              initialOption="Over Time"
              options={availableDimensions}
              value={selectedDimension}
              onChange={(v) => {
                if (v === selectedDimension) return;
                track("Select health tab dimension");
                setSelectedDimension(v);
              }}
              disabled={!availableDimensions.length}
            />
          </div>
        </div>

        <div className="mt-3 mb-3 d-flex align-items-center">
          <h3>
            Experiment Traffic by{" "}
            {selectedDimension
              ? availableDimensions.find((d) => d.value === selectedDimension)
                  ?.label
              : "Variation"}
          </h3>
          {!selectedDimension && (
            <div className="ml-auto">
              Cumulative{" "}
              <Toggle
                label="Cumulative"
                id="cumulative"
                value={cumulative}
                setValue={setCumulative}
              />
            </div>
          )}
        </div>
      </div>
      {selectedDimension ? (
        <table className="table w-75">
          <thead>
            <tr>
              <th className="border-top-0">
                {
                  availableDimensions.find((d) => d.value === selectedDimension)
                    ?.label
                }
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
                    {" "}
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
            {(traffic.dimension[selectedDimension] || []).map((r, i) => (
              <tr key={i}>
                <td className="border-right">{r.name || <em>unknown</em>}</td>
                {variations.map((v, i) => (
                  <td key={i}>
                    {numberFormatter.format(r.variationUnits[i] || 0)}
                  </td>
                ))}
                <td className="border-left">
                  {formatTrafficSplit(
                    variations.map((v) => v.weight),
                    1
                  )}
                </td>
                <td>
                  <b>
                    {formatTrafficSplit(
                      variations.map((v, i) => r.variationUnits[i] || 0),
                      1
                    )}
                  </b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="mt-2 mb-2">
          <ExperimentDateGraph
            yaxis="users"
            variationNames={variations.map((v) => v.name)}
            label="Users"
            datapoints={usersPerDate}
            tickFormat={(v) => numberFormatter.format(v)}
          />
        </div>
      )}
    </div>
  );
}
