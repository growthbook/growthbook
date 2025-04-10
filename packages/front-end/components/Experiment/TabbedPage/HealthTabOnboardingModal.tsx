import React, { FC, ReactElement, useEffect, useState } from "react";
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
import {
  DimensionSlicesRunner,
  getLatestDimensionSlices,
} from "@/components/Settings/EditDataSource/DimensionMetadata/UpdateDimensionMetadata";
import track, { trackSnapshot } from "@/services/track";
import RadioGroup from "@/components/Radix/RadioGroup";

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
      track("Save Dimension Metadata", { source });
      const updates: Partial<ExposureQuery> = {
        dimensionSlicesId: id,
        dimensionMetadata: data.dimensionSlices.results.map((r) => ({
          dimension: r.dimension,
          specifiedSlices: r.dimensionSlices.map((dv) => dv.name),
        })),
      };
      await apiCall(
        `/datasource/${dataSource.id}/exposureQuery/${exposureQuery.id}`,
        {
          method: "PUT",
          body: JSON.stringify({ updates }),
        }
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
        trackingEventModalType=""
        open={open}
        submit={close}
        cta={"确认"}
        includeCloseCta={false}
        size={"md"}
        header={`不进行${healthTabOnboardingPurpose === "setup"
          ? "启用健康标签页"
          : "配置实验维度"
          }直接退出`}
        secondaryCTA={
          <>
            <button
              className={`btn btn-link`}
              onClick={() => setStep(lastStep)}
            >
              {"后退"}
            </button>
          </>
        }
      >
        <div className="my-2 ml-3 mr-3">
          <div className="row mb-2">
            {`${healthTabOnboardingPurpose === "setup"
              ? "在你完成设置之前，健康标签页将不会启用"
              : "在你完成设置之前，实验维度将不会为健康标签页进行配置"
              }。`}
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
        header: "设置健康标签页",
        children: (
          <div>
            通过启用健康标签页，每次实验分析将额外运行一个查询，以自动提供有关流量随时间变化和维度细分的数据。
          </div>
        ),
        secondaryCTA: (
          <button
            className={`btn btn-primary`}
            type="submit"
            onClick={() => setStep(showDimensionsPage ? 1 : 2)}
          >
            {"下一步 >"}
          </button>
        ),
      },
      // step 1
      {
        header: "为健康标签页配置实验维度",
        children: (
          <>
            <div className="my-2 ml-3 mr-3">
              <div className="row mb-3">
                配置实验维度切片，以便将维度预先划分为最常见的值。这些维度随后将显示在你的健康标签页上，用于流量和实验平衡检查。
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
                {"跳过"}
              </button>
            ) : null}
            <button
              className={`btn btn-primary`}
              type="submit"
              disabled={!saveDimensionsEnabled}
              onClick={() => setStep(2)}
            >
              {"下一步 >"}
            </button>
          </>
        ),
      },
      // step 2
      {
        header: "设置健康标签页",
        children: (
          <>
            <div className="my-2 ml-3 mr-3">
              <div className="row mb-2">
                当你的数据刷新时，你的健康标签页将显示结果。
              </div>
              <div className="row">
                <RadioGroup
                  value={setupChoice}
                  setValue={(val: RefreshTypes) => setSetupChoice(val)}
                  options={[
                    {
                      value: "refresh",
                      label: "设置完成后刷新结果",
                    },
                    {
                      value: "norefresh",
                      label: "下次更新结果时刷新数据",

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
              {"< 后退"}
            </button>
            <div className="flex-1" />
            <button
              className={`btn btn-primary`}
              type="submit"
              onClick={setUpHealthTab}
            >
              {"完成安装"}
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
