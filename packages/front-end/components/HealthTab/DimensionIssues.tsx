import { ExperimentSnapshotTrafficDimension } from "back-end/types/experiment-snapshot";
import { ExperimentReportVariation } from "back-end/types/report";
import { useMemo, useState } from "react";
import { useUser } from "@/services/UserContext";
import { DEFAULT_SRM_THRESHOLD } from "@/pages/settings";
import track from "@/services/track";
import VariationUsersTable from "../Experiment/TabbedPage/VariationUsersTable";
import Modal from "../Modal";
import SelectField from "../Forms/SelectField";
import SRMWarning from "../Experiment/SRMWarning";
import { EXPERIMENT_DIMENSION_PREFIX, srmHealthCheck } from "./SRMDrawer";
import HealthCard from "./HealthCard";
import { IssueTags, IssueValue } from "./IssueTags";
import { HealthStatus } from "./StatusBadge";

interface Props {
  dimensionData: {
    [dimension: string]: ExperimentSnapshotTrafficDimension[];
  };
  variations: ExperimentReportVariation[];
}

type NewObjectArray = {
  value: string;
  label: string;
  issues: string[];
};

export function transformDimensionData(
  dimensionData: {
    [dimension: string]: ExperimentSnapshotTrafficDimension[];
  },
  variations: ExperimentReportVariation[],
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
        value: dimensionName,
        label: dimensionName.replace(EXPERIMENT_DIMENSION_PREFIX, ""),
        issues: issueNames,
      };
    }
  );
}

export const DimensionIssues = ({ dimensionData, variations }: Props) => {
  const { settings } = useUser();
  const [modalOpen, setModalOpen] = useState(false);

  const srmThreshold = settings.srmThreshold ?? DEFAULT_SRM_THRESHOLD;

  const availableDimensions = transformDimensionData(
    dimensionData,
    variations,
    srmThreshold
  ).sort((a, b) => b.issues.length - a.issues.length);

  //   const availableDimensions = [
  //     {
  //       value: "dim_browser",
  //       label: "browser",
  //       issues: ["ie", "chrome", "opera", "arc", "testing"],
  //     },
  //     {
  //       value: "dim_browser1",
  //       label: "browser",
  //       issues: ["ie", "chrome", "opera"],
  //     },
  //     {
  //       value: "dim_browser2",
  //       label: "browser",
  //       issues: ["ie", "chrome", "opera", "arc", "testing", "extra"],
  //     },
  //     {
  //       value: "dim_browser3",
  //       label: "browser",
  //       issues: [],
  //     },
  //     {
  //       value: "dim_browser4",
  //       label: "browser",
  //       issues: ["ie", "chrome", "opera"],
  //     },
  //     {
  //       value: "dim_browser4",
  //       label: "browser",
  //       issues: ["ie", "chrome", "opera"],
  //     },
  //   ].sort((a, b) => b.issues.length - a.issues.length);

  const [selectedDimension, setSelectedDimension] = useState(
    availableDimensions[0]?.value || ""
  );

  const [issues, dimensionSlicesWithHealth] = useMemo(() => {
    const dimensionSlicesWithIssues: IssueValue[] = [];
    const dimensionSlicesWithHealth: (ExperimentSnapshotTrafficDimension & {
      totalUsers: number;
      health: HealthStatus;
    })[] = [];
    dimensionData[selectedDimension]?.forEach((d) => {
      const totalDimUsers = d.variationUnits.reduce((acc, a) => acc + a, 0);
      const health = srmHealthCheck({
        srm: d.srm,
        srmThreshold,
        variations,
        totalUsers: totalDimUsers,
      });

      if (health === "Issues detected") {
        dimensionSlicesWithIssues.push({ label: d.name, value: d.name });
      }

      dimensionSlicesWithHealth.push({
        ...d,
        health,
        totalUsers: totalDimUsers,
      });
    });
    dimensionSlicesWithHealth.sort((a, b) => b.totalUsers - a.totalUsers);

    return [dimensionSlicesWithIssues, dimensionSlicesWithHealth];
  }, [dimensionData, selectedDimension, srmThreshold, variations]);

  const areDimensionsAvailable = !!availableDimensions.length;

  return (
    <>
      <Modal
        close={() => setModalOpen(false)}
        open={modalOpen}
        closeCta={"Okay"}
        header={
          <div>
            <h2>Explore Dimensions</h2>
            <p className="mb-0">
              Break down traffic by dimension to identify source of issues.
            </p>
          </div>
        }
        size="lg"
      >
        <div className="m-3">
          <div className="mb-4" style={{ maxWidth: 200 }}>
            <div className="uppercase-title text-muted">Dimension</div>
            <SelectField
              containerClassName={"select-dropdown-underline"}
              options={availableDimensions}
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
          <IssueTags issues={issues} />
          {selectedDimension && (
            <>
              {dimensionSlicesWithHealth.map((d) => {
                return (
                  <HealthCard
                    id={d.name}
                    title={d.name}
                    helpText={`(${d.totalUsers} total units)`}
                    status={d.health}
                    key={d.name}
                  >
                    <div className="mt-4">
                      <div className="mb-2">
                        <VariationUsersTable
                          users={d.variationUnits}
                          variations={variations}
                          srm={d.srm}
                        />
                        {(d.health === "healthy" ||
                          d.health === "Issues detected") && (
                          <SRMWarning
                            srm={d.srm}
                            variations={variations}
                            users={d.variationUnits}
                            showWhenHealthy
                          />
                        )}
                        {d.health === "Not enough traffic" && (
                          <div className="alert alert-info">
                            <b>
                              More traffic is required to detect a Sample Ratio
                              Mismatch (SRM).
                            </b>
                          </div>
                        )}
                      </div>
                    </div>
                  </HealthCard>
                );
              })}
            </>
          )}
        </div>
      </Modal>

      <div className="my-2 h-100">
        <div className="pl-4">
          <h3>Dimensions</h3>
          <p className="mb-4">Highlights perceived issues across dimensions</p>
        </div>

        <hr className="mb-0" />
        {areDimensionsAvailable ? (
          <div className="h-75">
            <div className="h-75 overflow-auto pt-4 pl-4">
              {availableDimensions.map((d) => {
                return (
                  <div key={d.value}>
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        setSelectedDimension(d.value);
                        setModalOpen(true);
                      }}
                    >
                      <h4>{d.label}</h4>
                    </a>
                    <p>
                      {" "}
                      {d.issues.length ? (
                        <>{d.issues.join(", ")}</>
                      ) : (
                        <i className="text-muted">No issues detected</i>
                      )}
                    </p>
                  </div>
                );
              })}
            </div>
            <div
              className="mt-4 py-3 px-4"
              style={{ boxShadow: "0px -5px 10px rgba(0, 0, 0, 0.1)" }}
            >
              <a
                className="text-lg"
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setModalOpen(true);
                }}
              >
                <h3>Explore dimensions {">"}</h3>
              </a>
            </div>
          </div>
        ) : (
          <i className="text-muted">No dimensions have been added</i>
        )}
      </div>
    </>
  );
};
