import { useEffect, useMemo, useState } from "react";
import {
  ExperimentMetricInterface,
  getAllMetricIdsFromExperiment,
  isBinomialMetric,
  isFactMetric,
  quantileMetricType,
} from "shared/experiments";
import { config, FullModalPowerCalculationParams } from "shared/power";
import { isProjectListValidForProject } from "shared/util";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import SelectField from "@/components/Forms/SelectField";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import Modal from "@/components/Modal";
import {
  defaultValue,
  PowerCalculationForm,
} from "@/components/PowerCalculation/PowerCalculationSettingsModal";
import HelperText from "@/ui/HelperText";
import RadioGroup from "@/ui/RadioGroup";
import Tooltip from "@/components/Tooltip/Tooltip";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import { ensureAndReturn } from "@/types/utils";

function resetMetricsUsersInForm({ form }: { form: PowerCalculationForm }) {
  form.setValue("metrics", {});
  form.setValue("usersPerWeek", undefined);
}

export const SelectStep = ({
  form,
  close,
  onNext,
  experiments,
}: {
  form: PowerCalculationForm;
  close?: () => void;
  onNext: () => void;
  experiments: ExperimentInterfaceStringDates[];
}) => {
  const {
    metrics: appMetrics,
    metricGroups,
    factMetrics: appFactMetrics,
    segments: appSegments,
    project,
    factTables: appFactTables,
    datasources,
  } = useDefinitions();
  const settings = useOrgSettings();
  const { hasCommercialFeature, permissionsUtil } = useUser();

  const hasHistoricalPower = hasCommercialFeature("historical-power");

  const metrics = form.watch("metrics");
  const selectedMetrics = Object.keys(metrics);

  const metricValuesSource = form.watch("metricValuesData.source");
  const metricValuesSourceId = form.watch("metricValuesData.sourceId");
  const selectedDatasource = form.watch("metricValuesData.datasource");
  const selectedIdType = form.watch("metricValuesData.identifierType");

  const [availablePopulations, setAvailablePopulations] = useState<
    { label: string; value: string }[]
  >([]);
  const [identifiers, setIdentifiers] = useState<string[]>([]);

  const isNextDisabled =
    !selectedMetrics.length &&
    (metricValuesSourceId !== "" || metricValuesSource === "manual") &&
    (hasHistoricalPower || metricValuesSource === "manual");

  const availableExperiments = useMemo(
    () =>
      experiments
        .map((exp) => {
          const datasource = datasources.find((d) => d.id === exp.datasource);
          const exposureQuery = datasource?.settings?.queries?.exposure?.find(
            (e) => e.id === exp.exposureQueryId,
          );

          return {
            ...exp,
            exposureQueryUserIdType: exposureQuery?.userIdType,
            allMetrics: getAllMetricIdsFromExperiment(exp, false, metricGroups),
          };
        })
        .filter((e) => {
          if (
            e.status === "draft" ||
            !e.exposureQueryUserIdType ||
            e.allMetrics.length === 0
          )
            return false;
          return true;
        }),
    [experiments, datasources, metricGroups],
  );

  const availableSegments = useMemo(
    () =>
      appSegments.filter((s) => {
        if (!isProjectListValidForProject(s.projects, project)) {
          return false;
        }
        const datasource = datasources.find((d) => d.id === s.datasource);
        if (
          !datasource ||
          !permissionsUtil.canRunPopulationDataQueries(datasource)
        ) {
          return false;
        }
        return true;
      }),
    [appSegments, datasources, project, permissionsUtil],
  );
  const availableFactTables = useMemo(
    () =>
      appFactTables.filter((ft) => {
        if (!isProjectListValidForProject(ft.projects, project)) {
          return false;
        }
        const datasource = datasources.find((d) => d.id === ft.datasource);
        if (
          !datasource ||
          !permissionsUtil.canRunPopulationDataQueries(datasource)
        ) {
          return false;
        }
        return true;
      }),
    [appFactTables, datasources, project, permissionsUtil],
  );

  // only allow metrics from the same datasource in an analysis
  // combine both metrics and remove quantile metrics
  const availableMetrics: ExperimentMetricInterface[] = useMemo(
    () =>
      [...appMetrics, ...appFactMetrics].filter((m) => {
        // drop quantile metrics
        if (quantileMetricType(m) !== "") return false;

        // include all for manual metric values source
        if (metricValuesSource === "manual") {
          return true;
        }

        // drop if not in experiment
        if (metricValuesSource === "experiment") {
          const experiment = availableExperiments.find(
            (e) => e.id === metricValuesSourceId,
          );

          if (experiment && !experiment.allMetrics.includes(m.id)) return false;
        }

        // drop if not in datasource
        if (selectedDatasource && m.datasource !== selectedDatasource)
          return false;

        // drop if does not have user id type
        const userIdTypes = !isFactMetric(m)
          ? m.userIdTypes
          : appFactTables.find((ft) => ft.id === m.numerator.factTableId)
              ?.userIdTypes;
        if (
          selectedIdType &&
          userIdTypes &&
          !userIdTypes.includes(selectedIdType)
        )
          return false;

        return true;
      }),
    [
      selectedDatasource,
      selectedIdType,
      appFactMetrics,
      appMetrics,
      appFactTables,
      metricValuesSource,
      metricValuesSourceId,
      availableExperiments,
    ],
  );

  useEffect(() => {
    const metricValuesData = form.getValues("metricValuesData");
    switch (metricValuesSource) {
      case "factTable": {
        setAvailablePopulations(
          availableFactTables.map((p) => ({ label: p.name, value: p.id })),
        );
        const factTable = availableFactTables.find(
          (f) => f.id === metricValuesSourceId,
        );
        if (factTable) {
          form.setValue("metricValuesData", {
            ...metricValuesData,
            source: metricValuesSource,
            sourceName: factTable.name,
            datasource: factTable.datasource,
            identifierType: factTable.userIdTypes[0],
          });
          setIdentifiers(factTable.userIdTypes);
        }
        break;
      }
      case "segment": {
        setAvailablePopulations(
          availableSegments.map((p) => ({ label: p.name, value: p.id })),
        );
        const segment = availableSegments.find(
          (s) => s.id === metricValuesSourceId,
        );
        if (segment) {
          form.setValue("metricValuesData", {
            ...metricValuesData,
            source: metricValuesSource,
            sourceName: segment.name,
            datasource: segment.datasource,
            identifierType: segment.userIdType,
          });
          setIdentifiers([segment.userIdType]);
        }
        break;
      }
      case "experiment": {
        setAvailablePopulations(
          availableExperiments.map((p) => ({ label: p.name, value: p.id })),
        );
        const experiment = availableExperiments.find(
          (e) => e.id === metricValuesSourceId,
        );
        if (experiment) {
          form.setValue("metricValuesData", {
            ...metricValuesData,
            source: metricValuesSource,
            sourceName: experiment.name,
            datasource: experiment.datasource,
            identifierType: experiment.exposureQueryUserIdType,
          });
          setIdentifiers(
            experiment.exposureQueryUserIdType
              ? [experiment.exposureQueryUserIdType]
              : [],
          );
        }
        break;
      }
      case "manual": {
        form.setValue("metricValuesData", {
          ...metricValuesData,
          source: metricValuesSource,
          sourceName: undefined,
          datasource: undefined,
          identifierType: undefined,
        });
        break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    metricValuesSource,
    metricValuesSourceId,
    availableExperiments,
    availableSegments,
    availableFactTables,
  ]);

  const field = (
    key: keyof typeof config,
    metric: ExperimentMetricInterface,
  ) => ({
    [key]: defaultValue(config[key], metric.priorSettings, settings),
  });

  const populationName = () => {
    switch (metricValuesSource) {
      case "factTable":
        return "Fact Table";
      case "experiment":
        return "Experiment";
      case "segment":
        return "Segment";
      case "manual":
        return "Manual entry";
    }
  };

  return (
    <Modal
      trackingEventModalType="power-calculation-select"
      open
      size="lg"
      header="New Power Calculation"
      close={close}
      includeCloseCta={false}
      cta="Next >"
      secondaryCTA={
        <button
          disabled={isNextDisabled}
          onClick={onNext}
          className="btn btn-primary"
        >
          Next &gt;
        </button>
      }
    >
      <>
        <p>
          Estimate the power of your future experiment based on user traffic and
          selected key metrics. Use <strong>Fact Tables</strong>,{" "}
          <strong>Segments</strong>, or <strong>Past Experiments</strong> to
          automatically calculate expected traffic and metric values to more
          reliably estimate power.
        </p>

        <div className="d-flex">
          <label className="font-weight-bold">Population Type</label>
          <PremiumTooltip
            premiumText={
              "Automated calculations based on Fact Tables, Segments, and Past Experiments are only available on the Pro or Enterprise plans."
            }
            commercialFeature="historical-power"
          >
            <></>
          </PremiumTooltip>
        </div>
        <div className="mb-2">
          Pick the population that best represents the users you are targeting
          with your experiment.
        </div>

        <RadioGroup
          value={metricValuesSource ?? "manual"}
          options={[
            {
              value: "factTable",
              label: "Fact table",
              disabled: !hasHistoricalPower,
            },
            {
              value: "segment",
              label: "Segment",
              disabled: !hasHistoricalPower,
            },
            {
              value: "experiment",
              label: "Past experiment",
              disabled: !hasHistoricalPower,
            },
            { value: "manual", label: "Enter values manually" },
          ]}
          setValue={(value) => {
            if (value !== metricValuesSource) {
              form.setValue(
                "metricValuesData.source",
                value as FullModalPowerCalculationParams["metricValuesData"]["source"],
              );
              // reset form values
              resetMetricsUsersInForm({ form });
              form.setValue("metricValuesData.sourceId", undefined);
              form.setValue("metricValuesData.sourceName", undefined);
              form.setValue("metricValuesData.identifierType", undefined);
              form.setValue("customizedMetrics", false);
            }
          }}
          mb="2"
        />

        {metricValuesSource !== "manual" ? (
          <>
            <SelectField
              label={
                <>
                  <span className="mr-auto font-weight-bold">
                    {populationName()}
                  </span>
                </>
              }
              value={metricValuesSourceId ?? ""}
              options={availablePopulations}
              onChange={(value) => {
                if (value != metricValuesSourceId) {
                  resetMetricsUsersInForm({ form });
                }
                form.setValue("metricValuesData.sourceId", value);
              }}
              className="mb-2"
              forceUndefinedValueToNull={true}
            />
            <SelectField
              label={
                <>
                  <span className="mr-auto font-weight-bold">
                    Identifier Type
                  </span>
                </>
              }
              disabled={identifiers.length <= 1}
              value={form.watch("metricValuesData.identifierType") ?? ""}
              options={identifiers.map((i) => ({ label: i, value: i }))}
              onChange={(value) =>
                form.setValue("metricValuesData.identifierType", value)
              }
              forceUndefinedValueToNull={true}
            />
          </>
        ) : null}

        <hr />

        <label className="mr-auto font-weight-bold">
          {" "}
          Select Metrics{" "}
          <Tooltip
            body={
              <>
                {metricValuesSource === "experiment" ? (
                  <p>
                    Only metrics analyzed with this experiment can be selected.
                  </p>
                ) : metricValuesSource !== "manual" ? (
                  <p>
                    Only metrics that are in the same datasource and share an
                    identifier type with your population can be selected.
                  </p>
                ) : null}
                <p>Quantile metrics cannot be selected.</p>
              </>
            }
          />
        </label>
        <div className="mb-2">
          Pick the key metrics for which you want to estimate power.
        </div>
        <MultiSelectField
          sort={false}
          value={selectedMetrics}
          options={availableMetrics.map(({ name: label, id: value }) => ({
            label,
            value,
          }))}
          isOptionDisabled={() => 5 <= selectedMetrics.length}
          disabled={!metricValuesSourceId && metricValuesSource !== "manual"}
          onChange={(value: string[]) => {
            form.setValue(
              "metrics",
              value.reduce((result, id) => {
                const metric = ensureAndReturn(
                  availableMetrics.find((m) => m.id === id),
                );
                if (!selectedDatasource)
                  form.setValue(
                    "metricValuesData.datasource",
                    metric.datasource,
                  );

                return {
                  ...result,
                  [id]: metrics[id] || {
                    name: metric.name,
                    ...field("effectSize", metric),
                    ...(isBinomialMetric(metric)
                      ? { type: "binomial", ...field("conversionRate", metric) }
                      : {
                          type: "mean",
                          ...field("mean", metric),
                          ...field("standardDeviation", metric),
                          standardDeviation: undefined,
                        }),
                    ...field("overrideMetricLevelSettings", metric),
                    ...field("overrideProper", metric),
                    ...field("overridePriorLiftMean", metric),
                    ...field("overridePriorLiftStandardDeviation", metric),
                    ...field("metricProper", metric),
                    ...field("metricPriorLiftMean", metric),
                    ...field("metricPriorLiftStandardDeviation", metric),
                  },
                };
              }, {}),
            );
          }}
        />

        {selectedMetrics.length === 5 && (
          <HelperText status="info" mb="3">
            Limit 5 metrics
          </HelperText>
        )}
      </>
    </Modal>
  );
};
