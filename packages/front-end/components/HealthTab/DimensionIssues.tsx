import { ExperimentSnapshotTrafficDimension } from "back-end/types/experiment-snapshot";
import { ExperimentReportVariation } from "back-end/types/report";
import { useState } from "react";
import { useUser } from "@/services/UserContext";
import { DEFAULT_SRM_THRESHOLD } from "@/pages/settings";
import track from "@/services/track";
import { pValueFormatter } from "@/services/experiments";
import VariationUsersTable from "../Experiment/TabbedPage/VariationUsersTable";
import Modal from "../Modal";
import SelectField from "../Forms/SelectField";
import { EXPERIMENT_DIMENSION_PREFIX, srmHealthCheck } from "./SRMDrawer";
import HealthCard from "./HealthCard";

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
  );

  const [selectedDimension, setSelectedDimension] = useState(
    availableDimensions[0].value
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
    <>
      <Modal
        close={() => setModalOpen(false)}
        open={modalOpen}
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
          {selectedDimension && (
            <>
              {dimensionData[selectedDimension].map((d) => {
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
                          {dimensionHealth === "Issues detected" && (
                            <p>replace me with new warning</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </HealthCard>
                );
              })}
            </>
          )}
        </div>
      </Modal>

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
