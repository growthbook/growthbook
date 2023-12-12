import React, { FC, ReactElement, useEffect, useState } from "react";
import { DimensionSlicesInterface } from "back-end/types/dimension";
import { ExposureQuery } from "back-end/types/datasource";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
} from "back-end/types/experiment-snapshot";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import { getQueryStatus } from "@/components/Queries/RunQueriesButton";
import Modal from "@/components/Modal";
import { useDefinitions } from "@/services/DefinitionsContext";
import RadioSelector from "@/components/Forms/RadioSelector";
import {
  DimensionSlicesRunner,
  getLatestDimensionSlices,
} from "@/components/Settings/EditDataSource/DimensionMetadata/UpdateDimensionMetadata";
import track, { trackSnapshot } from "@/services/track";

type HealthTabOnboardingModalProps = {
  open: boolean;
  close: () => void;
  healthTabOnboardingPurpose: HealthTabOnboardingPurpose;
  healthTabConfigParams: HealthTabConfigParams;
};

export type HealthTabConfigParams = {
  experiment: ExperimentInterfaceStringDates;
  phase: number;
  exposureQueryDimensions: string[];
  refreshOrganization: () => void;
  mutateSnapshot: () => void;
  setAnalysisSettings: (
    analysisSettings: ExperimentSnapshotAnalysisSettings | null
  ) => void;
  setLoading: (loading: boolean) => void;
  resetResultsSettings: () => void;
};

export type HealthTabOnboardingPurpose = "setup" | "dimensions";
type RefreshTypes = "refresh" | "norefresh";

export const HealthTabOnboardingModal: FC<HealthTabOnboardingModalProps> = ({
  open,
  close,
  healthTabOnboardingPurpose,
  healthTabConfigParams,
}) => {
  const {
    experiment,
    phase,
    exposureQueryDimensions,
    refreshOrganization,
    mutateSnapshot,
    setAnalysisSettings,
    setLoading,
    resetResultsSettings,
  } = healthTabConfigParams;

  const { apiCall } = useAuth();
  const startingStep = healthTabOnboardingPurpose === "setup" ? 0 : 1;
  const [setupChoice, setSetupChoice] = useState<RefreshTypes>("refresh");
  const [step, setStep] = useState(startingStep);
  const [lastStep, setLastStep] = useState(startingStep);
  const { getDatasourceById } = useDefinitions();
  const dataSource = getDatasourceById(experiment.datasource);

  const source = "health-tab-onboarding";

  if (!dataSource) {
    throw new Error("Data Source Not Found");
  }
  const exposureQuery = dataSource.settings.queries?.exposure?.find(
    (e) => e.id === experiment.exposureQueryId
  );
  if (!exposureQuery) {
    throw new Error("Exposure Query Not Found");
  }

  const metadataId = exposureQuery.dimensionSlicesId;
  const dataSourceId = dataSource.id;
  const exposureQueryId = exposureQuery.id;

  const [id, setId] = useState<string | null>(
    exposureQuery.dimensionSlicesId || null
  );
  const { data, error, mutate } = useApi<{
    dimensionSlices: DimensionSlicesInterface;
  }>(`/dimension-slices/${id}`);

  const setUpHealthTab = async () => {
    await apiCall(`/organization`, {
      method: "PUT",
      body: JSON.stringify({
        settings: { runHealthTrafficQuery: true },
      }),
    });
    if (
      id &&
      data?.dimensionSlices?.results &&
      data.dimensionSlices.results.length > 0
    ) {
      track("Save Dimension Metadata", { source });
      const updates: Partial<ExposureQuery> = {
        dimensionSlicesId: id,
        dimensionMetadata: data.dimensionSlices.results.map((r) => ({
          dimension: r.dimension,
          specifiedSlices: r.dimensionSlices.map((dv) => dv.name),
        })),
      };
      await apiCall(`/datasource/${dataSource.id}/${exposureQuery.id}`, {
        method: "PUT",
        body: JSON.stringify({ updates }),
      });
    }
    if (setupChoice === "refresh") {
      setLoading(true);
      apiCall<{ snapshot: ExperimentSnapshotInterface }>(
        `/experiment/${experiment.id}/snapshot`,
        {
          method: "POST",
          body: JSON.stringify({
            phase,
          }),
        }
      )
        .then((res) => {
          trackSnapshot(
            "create",
            "HealthTabOnboarding",
            dataSource?.type || null,
            res.snapshot
          );

          setAnalysisSettings(null);
          resetResultsSettings();
          mutateSnapshot();
        })
        .catch((e) => {
          console.error(e);
        });
    }
    close();
    refreshOrganization();
  };

  useEffect(
    () =>
      getLatestDimensionSlices(
        dataSourceId,
        exposureQueryId,
        metadataId,
        apiCall,
        setId,
        mutate
      ),
    [dataSourceId, exposureQueryId, metadataId, setId, apiCall, mutate]
  );

  if (error) {
    return <div className="alert alert-error">{error?.message}</div>;
  }
  const { status } = getQueryStatus(
    data?.dimensionSlices?.queries || [],
    data?.dimensionSlices?.error
  );

  // exit modal
  if (step === -1) {
    return (
      <Modal
        open={open}
        submit={close}
        cta={"Confirm"}
        includeCloseCta={false}
        size={"md"}
        header={`Exit without ${
          healthTabOnboardingPurpose === "setup"
            ? "Enabling Health Tab"
            : "Configuring Experiment Dimensions"
        }`}
        secondaryCTA={
          <>
            <button
              className={`btn btn-link`}
              onClick={() => setStep(lastStep)}
            >
              {"Back"}
            </button>
          </>
        }
      >
        <div className="my-2 ml-3 mr-3">
          <div className="row mb-2">
            {`${
              healthTabOnboardingPurpose === "setup"
                ? "The Health Tab will not be enabled"
                : "Experiment Dimensions will not be configured for the health tab"
            } until you complete setup.`}
          </div>
        </div>
      </Modal>
    );
  }

  const saveDimensionsEnabled =
    id &&
    status === "succeeded" &&
    data?.dimensionSlices?.results &&
    data.dimensionSlices.results.length > 0;

  const showDimensionsPage = exposureQueryDimensions.length > 0;

  const pages: {
    header: string;
    children: ReactElement;
    secondaryCTA: ReactElement;
  }[] = [
    // step 0
    {
      header: "Set up Health Tab",
      children: (
        <div>
          By enabling the health tab, one additional query will be run per
          experiment analysis to automatically provide data about traffic over
          time and dimension breakdowns.
        </div>
      ),
      secondaryCTA: (
        <button
          className={`btn btn-primary`}
          type="submit"
          onClick={() => setStep(showDimensionsPage ? 1 : 2)}
        >
          {"Next >"}
        </button>
      ),
    },
    // step 1
    {
      header: "Configure Experiment Dimensions for Health Tab",
      children: (
        <>
          <div className="my-2 ml-3 mr-3">
            <div className="row mb-3">
              Configure Experiment Dimension slices to pre-bin dimensions in the
              most common values. These dimensions will then display on your
              Health Tab for traffic and experiment balance checks.
            </div>
            <div className="row">
              <DimensionSlicesRunner
                dimensionSlices={data?.dimensionSlices}
                status={status}
                id={id}
                setId={setId}
                mutate={mutate}
                dataSource={dataSource}
                exposureQuery={exposureQuery}
                source={source}
              />
            </div>
          </div>
        </>
      ),
      secondaryCTA: (
        <>
          {healthTabOnboardingPurpose === "setup" ? (
            <button
              className={`btn btn-link`}
              onClick={() => {
                setStep(2);
              }}
            >
              {"Skip"}
            </button>
          ) : null}
          <button
            className={`btn btn-primary`}
            type="submit"
            disabled={!saveDimensionsEnabled}
            onClick={() => setStep(2)}
          >
            {"Next >"}
          </button>
        </>
      ),
    },
    // step 2
    {
      header: "Set up Health Tab",
      children: (
        <>
          <div className="my-2 ml-3 mr-3">
            <div className="row mb-2">
              Your Health Tab will display results when your data refreshes.
            </div>
            <div className="row">
              <div className="form-group">
                <RadioSelector
                  name="type"
                  value={setupChoice}
                  setValue={(val: RefreshTypes) => setSetupChoice(val)}
                  labelWidth={"100%"}
                  options={[
                    {
                      key: "refresh",
                      display: "Refresh results upon setup completion",
                      description: "",
                    },
                    {
                      key: "norefresh",
                      display: "Refresh data whenever you next update results",
                      description: "",
                    },
                  ]}
                />
              </div>
            </div>
          </div>
        </>
      ),
      secondaryCTA: (
        <>
          <button
            className={`btn btn-link`}
            onClick={() => setStep(showDimensionsPage ? 1 : 0)}
          >
            {"< Back"}
          </button>
          <div className="flex-1" />
          <button
            className={`btn btn-primary`}
            type="submit"
            onClick={setUpHealthTab}
          >
            {"Complete Setup"}
          </button>
        </>
      ),
    },
  ];

  const { header, children, secondaryCTA } = pages[step];

  return (
    <Modal
      open={open}
      close={() => {
        setLastStep(step);
        setStep(-1);
      }}
      includeCloseCta={false}
      secondaryCTA={secondaryCTA}
      size="lg"
      header={header}
    >
      {children}
    </Modal>
  );
};
