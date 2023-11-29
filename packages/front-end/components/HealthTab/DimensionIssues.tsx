import { ExperimentSnapshotTrafficDimension } from "back-end/types/experiment-snapshot";
import { ExperimentReportVariation } from "back-end/types/report";
import { useUser } from "@/services/UserContext";
import { DEFAULT_SRM_THRESHOLD } from "@/pages/settings";
import { DataPointVariation } from "../Experiment/ExperimentDateGraph";
import { EXPERIMENT_DIMENSION_PREFIX, srmHealthCheck } from "./SRMDrawer";

interface Props {
  dimensionData: {
    [dimension: string]: ExperimentSnapshotTrafficDimension[];
  };
  variations: ExperimentReportVariation[] | DataPointVariation[];
}

type NewObjectArray = {
  key: string;
  label: string;
  issues: string[];
};

function transformDimensionData(
  dimensionData: {
    [dimension: string]: ExperimentSnapshotTrafficDimension[];
  },
  variations: ExperimentReportVariation[] | DataPointVariation[],
  srmThreshold: number
): NewObjectArray[] {
  return Object.entries(dimensionData).flatMap(
    ([dimensionName, dimensionSlices]) => {
      // Skip for date dimension
      if (dimensionName === "dim_exposure_date") {
        return [];
      }

      const dimensionSlicesWithIssues = dimensionSlices.filter((item) => {
        const totalDimUsers = item.variationUnits.reduce(
          (acc, a) => acc + a,
          0
        );
        return (
          srmHealthCheck({
            srm: item.srm,
            variations,
            srmThreshold,
            totalUsers: totalDimUsers,
          }) !== "healthy"
        );
      });

      const issueNames = dimensionSlicesWithIssues.map((item) => item.name);

      // Construct the new object for the current dimension
      return {
        key: dimensionName,
        label: dimensionName.replace(EXPERIMENT_DIMENSION_PREFIX, ""),
        issues: issueNames,
      };
    }
  );
}

export const DimensionIssues = ({ dimensionData, variations }: Props) => {
  const { settings } = useUser();
  const srmThreshold = settings.srmThreshold ?? DEFAULT_SRM_THRESHOLD;

  const availableDimensions = transformDimensionData(
    dimensionData,
    variations,
    srmThreshold
  );

  //   const availableDimensions = [
  //     {
  //       key: "dim_browser",
  //       label: "browser",
  //       issues: ["ie", "chrome", "opera"],
  //     },
  //     {
  //       key: "dim_browser1",
  //       label: "browser",
  //       issues: ["ie", "chrome", "opera"],
  //     },
  //     {
  //       key: "dim_browser2",
  //       label: "browser",
  //       issues: ["ie", "chrome", "opera"],
  //     },
  //     {
  //       key: "dim_browser3",
  //       label: "browser",
  //       issues: ["ie", "chrome", "opera"],
  //     },
  //     {
  //       key: "dim_browser4",
  //       label: "browser",
  //       issues: ["ie", "chrome", "opera"],
  //     },
  //     {
  //       key: "dim_browser4",
  //       label: "browser",
  //       issues: ["ie", "chrome", "opera"],
  //     },
  //   ];

  const areDimensionsAvailable = !!availableDimensions.length;

  return (
    <div className="my-2 mx-4 h-100">
      <h3>Dimensions</h3>
      <p className="mb-4" style={{ boxShadow: "0 4 2px -2px gray" }}>
        Highlights perceived issues across dimensions
      </p>

      {areDimensionsAvailable ? (
        <div className="h-75">
          <div className="h-75 overflow-auto">
            {availableDimensions.map((d) => {
              return (
                <div key={d.key}>
                  <a href="#">
                    <h4>{d.label}</h4>
                  </a>
                  {d.issues.length ? (
                    <p>{d.issues.join(", ")}</p>
                  ) : (
                    <i className="text-muted">No issues detected</i>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-auto">
            <hr></hr>
            <a className="text-lg" href="#">
              <h3>Explore dimensions {">"}</h3>
            </a>
          </div>
        </div>
      ) : (
        <i className="text-muted">No dimensions have been added</i>
      )}
    </div>
  );
};
