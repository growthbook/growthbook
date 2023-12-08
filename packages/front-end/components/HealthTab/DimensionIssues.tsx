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

type DimensionWithIssues = {
  value: string;
  label: string;
  issues: string[];
};

const numberFormatter = new Intl.NumberFormat();

export function transformDimensionData(
  dimensionData: {
    [dimension: string]: ExperimentSnapshotTrafficDimension[];
  },
  variations: ExperimentReportVariation[],
  srmThreshold: number
): DimensionWithIssues[] {
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

  const [selectedDimension, setSelectedDimension] = useState(
    availableDimensions[0]?.value || ""
  );

  const [issues, dimensionSlicesWithHealth] = useMemo(() => {
    const dimensionSlicesWithHealth: (ExperimentSnapshotTrafficDimension & {
      totalUsers: number;
      health: HealthStatus;
    })[] = dimensionData[selectedDimension]?.map((d) => {
      const totalDimUsers = d.variationUnits.reduce((acc, a) => acc + a, 0);
      const health = srmHealthCheck({
        srm: d.srm,
        srmThreshold,
        variations,
        totalUsers: totalDimUsers,
      });

      return {
        ...d,
        health,
        totalUsers: totalDimUsers,
      };
    });
    dimensionSlicesWithHealth?.sort((a, b) => b.totalUsers - a.totalUsers);

    const dimensionSlicesWithIssues = dimensionSlicesWithHealth?.reduce(
      (acc, cur) => {
        if (cur.health === "Issues detected") {
          acc.push({ label: cur.name, value: cur.name });
        }

        return acc;
      },
      ([] as IssueValue[]) ?? []
    );

    return [dimensionSlicesWithIssues, dimensionSlicesWithHealth];
  }, [dimensionData, selectedDimension, srmThreshold, variations]);

  const areDimensionsAvailable = !!availableDimensions.length;

  return (
    <>
      <Modal
        close={() => setModalOpen(false)}
        open={modalOpen}
        closeCta={"Close"}
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
              disabled={!areDimensionsAvailable}
            />
          </div>

          <div className="d-flex justify-content-between">
            <IssueTags issues={issues} />
            {!!issues?.length && (
              <span className="col-auto ml-auto text-muted">
                Sorted by unit counts
              </span>
            )}
          </div>

          {selectedDimension && (
            <>
              {dimensionSlicesWithHealth?.map((d) => {
                return (
                  <HealthCard
                    id={d.name}
                    title={d.name}
                    helpText={`${numberFormatter.format(
                      d.totalUsers
                    )} total units`}
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
                            type="simple"
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

      <div className="d-flex flex-column h-100">
        <div className="px-4">
          <h3>Dimensions</h3>
          <p className="mt-1">Highlights perceived issues across dimensions</p>
        </div>

        <hr className="my-0 w-100" />
        {areDimensionsAvailable ? (
          <>
            <div
              className="flex-fill flex-shrink-1 overflow-auto px-4"
              style={{ paddingTop: "12px" }}
            >
              {availableDimensions.map((d) => {
                return (
                  <div key={d.value}>
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        setSelectedDimension(d.value);
                        track("Open health tab dimension modal");
                        setModalOpen(true);
                      }}
                    >
                      <p style={{ marginBottom: "2px" }}>
                        <b>{d.label}</b>
                      </p>
                    </a>
                    <p>
                      {d.issues.length ? (
                        <>
                          <b>Issues: </b>
                          {d.issues.join(", ")}
                        </>
                      ) : (
                        <i className="text-muted">No issues detected</i>
                      )}
                    </p>
                  </div>
                );
              })}
            </div>
            {/*TODO: if size of dimension list area is greater than header + footer add boxShadow. Hide otherwise.*/}
            <div
              className="py-3 px-4 w-100"
              style={{
                boxShadow: "0px -5px 10px rgba(0, 0, 0, 0.1)",
              }}
            >
              <a
                className="text-lg"
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  track("Open health tab dimension modal");
                  setModalOpen(true);
                }}
              >
                <h3>Explore dimensions {">"}</h3>
              </a>
            </div>
          </>
        ) : (
          <div className="pt-4 px-4">
            <i className="text-muted">
              No experiment dimensions with pre-defined slices available
            </i>
          </div>
        )}
      </div>
    </>
  );
};
