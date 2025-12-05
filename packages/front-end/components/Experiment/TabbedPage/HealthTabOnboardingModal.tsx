import React, { FC, ReactElement, useState } from "react";
import { DimensionSlicesInterface } from "back-end/types/dimension";
import {
  DataSourceInterfaceWithParams,
  ExposureQuery,
} from "back-end/types/datasource";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
} from "back-end/types/experiment-snapshot";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import { getQueryStatus } from "@/components/Queries/RunQueriesButton";
import Modal from "@/components/Modal";
import track, { trackSnapshot } from "@/services/track";
import RadioGroup from "@/ui/RadioGroup";
import {
  CustomDimensionMetadata,
  DimensionSlicesRunner,
} from "@/components/Settings/EditDataSource/DimensionMetadata/DimensionSlicesRunner";

type HealthTabOnboardingModalProps = {
  open: boolean;
  close: () => void;
  dataSource: DataSourceInterfaceWithParams;
  exposureQuery: ExposureQuery;
  healthTabOnboardingPurpose: HealthTabOnboardingPurpose;
  healthTabConfigParams: HealthTabConfigParams;
};

export type HealthTabConfigParams = {
  experiment: ExperimentInterfaceStringDates;
  phase: number;
  refreshOrganization: () => void;
  mutateSnapshot: () => void;
  setAnalysisSettings: (
    analysisSettings: ExperimentSnapshotAnalysisSettings | null,
  ) => void;
  setLoading: (loading: boolean) => void;
  resetResultsSettings: () => void;
};

export type HealthTabOnboardingPurpose = "setup" | "dimensions";
type RefreshTypes = "refresh" | "norefresh";

export const HealthTabOnboardingModal: FC<HealthTabOnboardingModalProps> = ({
  open,
  close,
  dataSource,
  exposureQuery,
  healthTabOnboardingPurpose,
  healthTabConfigParams,
}) => {
  const {
    experiment,
    phase,
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

  // track custom slices + priority locally
  const [customDimensionMetadata, setCustomDimensionMetadata] = useState<
    CustomDimensionMetadata[]
  >(
    exposureQuery.dimensions?.map((d, i) => {
      const existingMetadata = exposureQuery.dimensionMetadata?.find(
        (m) => m.dimension === d,
      );
      return {
        dimension: d,
        customSlicesArray: existingMetadata?.customSlices
          ? existingMetadata.specifiedSlices
          : undefined,
        priority: i + 1,
      };
    }) ?? [],
  );

  const source = "health-tab-onboarding";

  const metadataId = exposureQuery.dimensionSlicesId;
  const dataSourceId = dataSource.id;
  const exposureQueryId = exposureQuery.id;

  const [id, setId] = useState<string | null>(metadataId || null);
  const { data, error, mutate } = useApi<{
    dimensionSlices: DimensionSlicesInterface;
  }>(`/dimension-slices/${id}`);

  const setUpHealthTab = async () => {
    track("Set Up Health Tab", { source });
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
      const orderedDimensions = exposureQuery.dimensions.sort((a, b) => {
        const aMetadata = customDimensionMetadata.find(
          (m) => m.dimension === a,
        );
        const bMetadata = customDimensionMetadata.find(
          (m) => m.dimension === b,
        );
        // if missing metadata, put it at the end
        if (!aMetadata) return 1;
        if (!bMetadata) return -1;
        return aMetadata.priority - bMetadata.priority;
      });

      const updates: Partial<ExposureQuery> = {
        dimensionSlicesId: id,
        dimensions: orderedDimensions,
        dimensionMetadata: customDimensionMetadata.map((d) => ({
          dimension: d.dimension,
          specifiedSlices: d.customSlicesArray?.length
            ? d.customSlicesArray
            : (data.dimensionSlices.results
                .find((r) => r.dimension === d.dimension)
                ?.dimensionSlices.map((s) => s.name) ?? []),
        })),
      };
      await apiCall(
        `/datasource/${dataSource.id}/exposureQuery/${exposureQuery.id}`,
        {
          method: "PUT",
          body: JSON.stringify({ updates }),
        },
      );
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
        },
      )
        .then((res) => {
          trackSnapshot(
            "create",
            "HealthTabOnboarding",
            dataSource?.type || null,
            res.snapshot,
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

  if (error) {
    return <div className="alert alert-error">{error?.message}</div>;
  }
  const { status } = getQueryStatus(
    data?.dimensionSlices?.queries || [],
    data?.dimensionSlices?.error,
  );

  // exit modal
  if (step === -1) {
    return (
      <Modal
        trackingEventModalType=""
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

  const showDimensionsPage = exposureQuery.dimensions.length > 0;

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
                exposureQueryId={exposureQueryId}
                datasourceId={dataSourceId}
                customDimensionMetadata={customDimensionMetadata}
                setCustomDimensionMetadata={setCustomDimensionMetadata}
                dimensionSlices={data?.dimensionSlices}
                mutateDimensionSlices={mutate}
                setDimensionSlicesId={setId}
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
              <RadioGroup
                value={setupChoice}
                setValue={(val: RefreshTypes) => setSetupChoice(val)}
                options={[
                  {
                    value: "refresh",
                    label: "Refresh results upon setup completion",
                  },
                  {
                    value: "norefresh",
                    label: "Refresh data whenever you next update results",
                  },
                ]}
              />
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
      trackingEventModalType=""
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
