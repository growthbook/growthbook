import { ExperimentSnapshotTrafficDimension } from "shared/types/experiment-snapshot";
import { ExperimentReportVariation } from "shared/types/report";
import { useMemo, useState } from "react";
import {
  DataSourceInterfaceWithParams,
  ExposureQuery,
} from "shared/types/datasource";
import { getSRMHealthData, SRMHealthStatus } from "shared/health";
import {
  DEFAULT_SRM_BANDIT_MINIMINUM_COUNT_PER_VARIATION,
  DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
  DEFAULT_SRM_THRESHOLD,
} from "shared/constants";
import { useUser } from "@/services/UserContext";
import track from "@/services/track";
import VariationUsersTable from "@/components/Experiment/TabbedPage/VariationUsersTable";
import Modal from "@/components/Modal";
import SelectField from "@/components/Forms/SelectField";
import SRMWarning from "@/components/Experiment/SRMWarning";
import {
  HealthTabConfigParams,
  HealthTabOnboardingModal,
} from "@/components/Experiment/TabbedPage/HealthTabOnboardingModal";
import { EXPERIMENT_DIMENSION_PREFIX } from "./SRMCard";
import HealthCard from "./HealthCard";
import { IssueTags, IssueValue } from "./IssueTags";

interface Props {
  dimensionData: {
    [dimension: string]: ExperimentSnapshotTrafficDimension[];
  };
  dataSource: DataSourceInterfaceWithParams | null;
  exposureQuery?: ExposureQuery;
  variations: ExperimentReportVariation[];
  healthTabConfigParams?: HealthTabConfigParams;
  canConfigHealthTab: boolean;
  isBandit?: boolean;
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
  srmThreshold: number,
  isBandit: boolean,
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
          0,
        );
        return (
          getSRMHealthData({
            srm: item.srm,
            numOfVariations: variations.length,
            srmThreshold,
            totalUsersCount: totalDimUsers,
            minUsersPerVariation: isBandit
              ? DEFAULT_SRM_BANDIT_MINIMINUM_COUNT_PER_VARIATION
              : DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
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
    },
  );
}

export const DimensionIssues = ({
  dimensionData,
  variations,
  dataSource,
  exposureQuery,
  healthTabConfigParams,
  canConfigHealthTab,
  isBandit,
}: Props) => {
  const { settings } = useUser();
  const [modalOpen, setModalOpen] = useState(false);
  const [setupModalOpen, setSetupModalOpen] = useState(false);

  const srmThreshold = settings.srmThreshold ?? DEFAULT_SRM_THRESHOLD;

  const availableDimensions = transformDimensionData(
    dimensionData,
    variations,
    srmThreshold,
    !!isBandit,
  ).sort((a, b) => b.issues.length - a.issues.length);

  const [selectedDimension, setSelectedDimension] = useState(
    availableDimensions[0]?.value,
  );

  const [issues, dimensionSlicesWithHealth] = useMemo(() => {
    const dimensionSlicesWithHealth: (ExperimentSnapshotTrafficDimension & {
      totalUsers: number;
      health: SRMHealthStatus;
    })[] = dimensionData[selectedDimension]?.map((d) => {
      const totalDimUsers = d.variationUnits.reduce((acc, a) => acc + a, 0);
      const health = getSRMHealthData({
        srm: d.srm,
        srmThreshold,
        numOfVariations: variations.length,
        totalUsersCount: totalDimUsers,
        minUsersPerVariation: isBandit
          ? DEFAULT_SRM_BANDIT_MINIMINUM_COUNT_PER_VARIATION
          : DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
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
        if (cur.health === "unhealthy") {
          acc.push({ label: cur.name, value: cur.name });
        }

        return acc;
      },
      [] as IssueValue[],
    );

    return [dimensionSlicesWithIssues, dimensionSlicesWithHealth];
  }, [
    dimensionData,
    selectedDimension,
    srmThreshold,
    variations.length,
    isBandit,
  ]);

  const areDimensionsAvailable = !!availableDimensions.length;

  return (
    <>
      <Modal
        trackingEventModalType="srm-dimension-issues"
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
                      d.totalUsers,
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
                        {d.health !== "not-enough-traffic" ? (
                          <SRMWarning
                            srm={d.srm}
                            variations={variations}
                            users={d.variationUnits}
                            showWhenHealthy
                            type="simple"
                            isBandit={isBandit}
                          />
                        ) : (
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
            {/*TODO: if size of dimension list area is greater than DimensionIssues - (header + footer) add boxShadow. Hide otherwise.*/}
            <div
              className="py-3 px-4 w-100"
              style={{
                boxShadow: "0px -5px 10px rgba(0, 0, 0, 0.1)",
              }}
            >
              <a
                className="a text-lg"
                role="button"
                onClick={() => {
                  track("Open health tab dimension modal");
                  setModalOpen(true);
                }}
              >
                <h3>Explore dimensions {">"}</h3>
              </a>
            </div>
          </>
        ) : (
          <>
            <div className="pt-4 px-4">
              <i className="text-muted">
                {`No experiment dimensions ${
                  (exposureQuery?.dimensions ?? []).length > 0
                    ? "with pre-defined slices available"
                    : "available"
                }`}
              </i>
            </div>
            {exposureQuery?.dimensions &&
            dataSource &&
            canConfigHealthTab &&
            exposureQuery.dimensions.length > 0 &&
            healthTabConfigParams ? (
              <div className="pt-4 d-flex justify-content-center">
                <div>
                  <a
                    href="#"
                    className="btn btn-outline-primary"
                    onClick={() => {
                      track("Health Tab Onboarding Opened", {
                        source: "dimension-issues",
                      });
                      setSetupModalOpen(true);
                    }}
                  >
                    Configure experiment dimension slices
                  </a>
                </div>
                {setupModalOpen ? (
                  <HealthTabOnboardingModal
                    open={setupModalOpen}
                    close={() => setSetupModalOpen(false)}
                    dataSource={dataSource}
                    exposureQuery={exposureQuery}
                    healthTabConfigParams={healthTabConfigParams}
                    healthTabOnboardingPurpose={"dimensions"}
                  />
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    </>
  );
};
