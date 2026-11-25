import { IconButton } from "@radix-ui/themes";
import { PopulationDataInterface } from "shared/types/population-data";
import { useEffect, useState } from "react";
import { BsThreeDotsVertical } from "react-icons/bs";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  ensureAndReturnPowerCalculationParams,
  FullModalPowerCalculationParams,
  isValidPowerCalculationParams,
} from "shared/power";
import Field from "@/components/Forms/Field";
import Modal from "@/components/Modal";
import {
  postPopulationData,
  setMetricDataFromPopulationData,
} from "@/components/PowerCalculation/power-calculation-utils";
import { PowerCalculationForm } from "@/components/PowerCalculation/PowerCalculationSettingsModal";
import { MetricParamsInput } from "@/components/PowerCalculation/PowerCalculationSettingsModal/MetricInputs";
import AsyncQueriesModal from "@/components/Queries/AsyncQueriesModal";
import RunQueriesButton from "@/components/Queries/RunQueriesButton";
import ViewAsyncQueriesButton from "@/components/Queries/ViewAsyncQueriesButton";
import Callout from "@/ui/Callout";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Tooltip from "@/components/Tooltip/Tooltip";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";

const DataInput = ({
  form,
  engineType,
  metricsEditable,
}: {
  form: PowerCalculationForm;
  engineType: "bayesian" | "frequentist";
  metricsEditable: boolean;
}) => {
  const { t } = useLingui();
  const metrics = form.getValues("metrics");
  const metricIds = Object.keys(metrics);

  const usersPerWeek = form.watch("usersPerWeek");
  const isUsersPerDayInvalid = usersPerWeek !== undefined && usersPerWeek <= 0;

  return (
    <>
      <div className="ml-2 mt-4">
        <Field
          size="legacy"
          label={
            <div>
              <span className="font-weight-bold mr-1">
                <Trans>Estimated Users Per Week</Trans>
              </span>
              <Tooltip
                popperClassName="text-left"
                body={t`Total users across all variations`}
                tipPosition="right"
              />
            </div>
          }
          type="number"
          {...form.register("usersPerWeek", {
            valueAsNumber: true,
          })}
          disabled={!metricsEditable}
          className={isUsersPerDayInvalid ? "border border-danger" : undefined}
          helpText={
            isUsersPerDayInvalid ? (
              <div className="text-danger">
                <Trans>Must be greater than 0</Trans>
              </div>
            ) : undefined
          }
        />
      </div>
      <div className="ml-2">
        {metricIds.map((metricId) => (
          <MetricParamsInput
            key={metricId}
            metricId={metricId}
            engineType={engineType}
            form={form}
            disableValue={!metricsEditable}
          />
        ))}
      </div>
    </>
  );
};

const ResetText = ({
  form,
  metricsEditable,
  setMetricsEditable,
}: {
  form: PowerCalculationForm;
  metricsEditable: boolean;
  setMetricsEditable: (value: boolean) => void;
}) => {
  const { t } = useLingui();
  const metrics = form.getValues("metrics");

  if (metricsEditable) {
    return (
      <Tooltip
        body={t`Reset to data values`}
        usePortal={true}
        tipPosition="top"
      >
        <a
          role="button"
          className="ml-1 mb-0"
          onClick={() => {
            const savedData = form.getValues("savedData");
            let savedMetrics = {};
            for (const [id, m] of Object.entries(metrics)) {
              const oldMetricValues = savedData?.metrics[id];
              if (oldMetricValues) {
                savedMetrics = {
                  ...savedMetrics,
                  [id]: {
                    ...oldMetricValues,
                    // don't override effect size
                    effectSize: m.effectSize,
                    overrideMetricLevelSettings: m.overrideMetricLevelSettings,
                    overridePriorLiftMean: m.overridePriorLiftMean,
                    overridePriorLiftStandardDeviation:
                      m.overridePriorLiftStandardDeviation,
                    overrideProper: m.overrideProper,
                  },
                };
              } else {
                savedMetrics = {
                  ...savedMetrics,
                  [id]: m,
                };
              }
            }

            form.setValue("customizedMetrics", false);
            form.setValue("metrics", savedMetrics);
            form.setValue("usersPerWeek", savedData?.usersPerWeek);
            setMetricsEditable(false);
          }}
        >
          <Trans>Reset to data values.</Trans>
        </a>
      </Tooltip>
    );
  }

  return (
    <a
      role="button"
      className="ml-1 mb-0"
      onClick={() => {
        setMetricsEditable(true);
        form.setValue("customizedMetrics", true);
      }}
    >
      <Trans>Customize values.</Trans>
    </a>
  );
};

const PopulationDataQueryInput = ({
  form,
  engineType,
}: {
  form: PowerCalculationForm;
  engineType: "bayesian" | "frequentist";
}) => {
  const { t } = useLingui();
  const { apiCall } = useAuth();
  const { permissionsUtil } = useUser();
  const { getDatasourceById } = useDefinitions();

  const [dropdownOpen, setDropdownOpen] = useState<boolean>(false);
  const [queryModalOpen, setQueryModalOpen] = useState<boolean>(false);
  const [metricsEditable, setMetricsEditable] = useState<boolean>(true);

  const metricValuesData = form.watch("metricValuesData");
  const metricValuesSourceId = metricValuesData?.sourceId;
  const datasource = metricValuesData?.datasource;
  const metricValuesPopulationId = metricValuesData?.populationId;
  const datasourceProjects = datasource
    ? getDatasourceById(datasource)?.projects
    : [];

  const customizedMetrics = form.getValues("customizedMetrics");

  const canRunPopulationQuery = permissionsUtil.canRunPopulationDataQueries({
    projects: datasourceProjects ?? [],
  });

  const {
    data,
    error: getError,
    mutate,
  } = useApi<{
    populationData: PopulationDataInterface;
  }>(`/population-data/${metricValuesPopulationId}`, {
    shouldRun: () => !!metricValuesPopulationId,
  });

  const populationData = data?.populationData;

  const [error, setError] = useState<string | undefined>(undefined);
  const selectError = form.watch("metricValuesData.error");

  useEffect(() => {
    setError(getError?.message ?? selectError);
  }, [getError, setError, selectError]);

  useEffect(() => {
    if (populationData?.status === "success" && !customizedMetrics) {
      setMetricDataFromPopulationData({ populationData, form });
      setMetricsEditable(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [populationData]);

  if (!metricValuesSourceId) return null;

  const sourceName = form.watch("metricValuesData.sourceName");

  // TODO add url sharing and save populationId + metric
  return (
    <>
      {queryModalOpen ? (
        <AsyncQueriesModal
          queries={populationData?.queries?.map((q) => q.query) ?? []}
          savedQueries={[]}
          error={populationData?.error}
          close={() => setQueryModalOpen(false)}
        />
      ) : null}
      <div className="ml-2 row align-items-center">
        <div className="col-auto pl-0">
          <Trans>
            Compute metric values using last 8 weeks of data from{" "}
            <strong>{sourceName}</strong>.
          </Trans>
        </div>
        <div style={{ flex: 1 }} />
        <div className="col-auto">
          {canRunPopulationQuery && (
            <RunQueriesButton
              icon="refresh"
              cta={
                populationData?.status === "success"
                  ? t`Refresh Data`
                  : t`Get Data`
              }
              mutate={mutate}
              model={
                populationData ?? {
                  queries: [],
                  runStarted: new Date(),
                }
              }
              cancelEndpoint={`/population-data/${populationData?.id}/cancel`}
              onSubmit={async () => {
                try {
                  form.setValue("customizedMetrics", false);
                  const res = await postPopulationData({
                    form,
                    apiCall,
                    force: true,
                  });
                  form.setValue(
                    "metricValuesData.populationId",
                    res.populationData?.id,
                  );
                  setMetricsEditable(false);
                  mutate();
                } catch (e) {
                  setError(e.message);
                }
              }}
            />
          )}
        </div>
        <div className="col-auto pl-0">
          <DropdownMenu
            trigger={
              <IconButton
                variant="ghost"
                color="gray"
                radius="full"
                size="2"
                highContrast
              >
                <BsThreeDotsVertical size={18} />
              </IconButton>
            }
            open={dropdownOpen}
            onOpenChange={(o) => {
              setDropdownOpen(!!o);
            }}
            menuPlacement="end"
          >
            <DropdownMenuItem
              onClick={() => {
                setQueryModalOpen(true);
                setDropdownOpen(false);
              }}
              disabled={!populationData?.queries?.length}
            >
              <Trans>View Queries</Trans>
            </DropdownMenuItem>
          </DropdownMenu>
        </div>
      </div>
      {populationData?.status === "error" || error ? (
        <>
          {populationData?.status === "error" ? (
            <Callout status={"error"} mt={"2"}>
              <Trans>
                Queries failed. Investigate the issue, pick a different
                population and/or metric, or enter values manually.
              </Trans>
              <br />
              <ViewAsyncQueriesButton
                queries={populationData?.queries?.map((q) => q.query) ?? []}
                error={populationData?.error}
                icon={null}
                hideQueryCount={true}
                className="btn btn-link p-0 pt-1"
              />
            </Callout>
          ) : error ? (
            <Callout status={"error"} mt={"2"}>
              <Trans>
                Error starting queries: Try a different population and/or metric
                or enter values manually.
              </Trans>
              <br />
              {error}
            </Callout>
          ) : null}
          <hr />
          <DataInput
            form={form}
            engineType={engineType}
            metricsEditable={true}
          />
        </>
      ) : null}
      {populationData?.status === "success" && (
        <>
          <hr />{" "}
          <div className="ml-2 mb-2">
            <Trans>Metric values below pre-filled from query data.</Trans>
            <ResetText
              form={form}
              metricsEditable={metricsEditable}
              setMetricsEditable={setMetricsEditable}
            />
          </div>
          <DataInput
            form={form}
            engineType={engineType}
            metricsEditable={metricsEditable}
          />
        </>
      )}
    </>
  );
};

const ExperimentDataInput = ({
  form,
  engineType,
}: {
  form: PowerCalculationForm;
  engineType: "bayesian" | "frequentist";
}) => {
  const error = form.watch("metricValuesData.error");
  const sourceName = form.getValues("metricValuesData.sourceName");

  const [metricsEditable, setMetricsEditable] = useState<boolean>(!!error);

  return (
    <>
      <div className="ml-2 mb-2">
        <Trans>
          Metric values below pre-filled from experiment:{" "}
          <strong>{sourceName}.</strong>
        </Trans>
        <ResetText
          form={form}
          metricsEditable={metricsEditable}
          setMetricsEditable={setMetricsEditable}
        />
      </div>
      {error ? (
        <Callout status={"error"} mt={"2"}>
          <Trans>
            Error populating data: Try a different population and/or metric or
            enter values manually.
          </Trans>
          <br />
          {error}
        </Callout>
      ) : null}
      <DataInput
        form={form}
        engineType={engineType}
        metricsEditable={metricsEditable}
      />
    </>
  );
};

export const SetParamsStep = ({
  form,
  close,
  onBack,
  onSubmit,
  engineType,
}: {
  form: PowerCalculationForm;
  close?: () => void;
  onBack: () => void;
  onSubmit: (_: FullModalPowerCalculationParams) => void;
  engineType: "bayesian" | "frequentist";
}) => {
  const { t } = useLingui();
  const metricValuesSource = form.watch("metricValuesData.source");

  let inputModal: JSX.Element | null = null;
  switch (metricValuesSource) {
    case "segment":
    case "factTable":
      inputModal = (
        <PopulationDataQueryInput form={form} engineType={engineType} />
      );
      break;
    case "experiment":
      inputModal = <ExperimentDataInput form={form} engineType={engineType} />;
      break;
    case "manual":
      inputModal = (
        <DataInput form={form} engineType={engineType} metricsEditable={true} />
      );
      break;
  }
  return (
    <Modal
      trackingEventModalType="power-calculation-set-params"
      allowlistedTrackingEventProps={{
        source: form.getValues("metricValuesData.source"),
      }}
      open
      size="lg"
      header={t`New Calculation`}
      close={close}
      includeCloseCta={false}
      cta={t`Submit`}
      secondaryCTA={
        <button className="btn btn-link" onClick={onBack}>
          <Trans>&lt; Back</Trans>
        </button>
      }
      tertiaryCTA={
        <button
          disabled={
            !isValidPowerCalculationParams(engineType, form.getValues())
          }
          className="btn btn-primary"
          onClick={() =>
            onSubmit(
              ensureAndReturnPowerCalculationParams(
                engineType,
                form.getValues(),
              ),
            )
          }
        >
          <Trans>Submit</Trans>
        </button>
      }
    >
      {inputModal}
    </Modal>
  );
};
