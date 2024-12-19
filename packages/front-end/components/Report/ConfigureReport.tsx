import { ExperimentSnapshotReportInterface } from "back-end/types/report";
import React, { RefObject, useState } from "react";
import { useForm } from "react-hook-form";
import {
  AttributionModel,
  ExperimentInterfaceStringDates,
} from "back-end/types/experiment";
import { date, getValidDate } from "shared/dates";
import { DifferenceType } from "back-end/types/stats";
import { MdInfoOutline } from "react-icons/md";
import { DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER } from "shared/constants";
import Button from "@/components/Radix/Button";
import DatePicker from "@/components/DatePicker";
import useApi from "@/hooks/useApi";
import Field from "@/components/Forms/Field";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/Radix/Tabs";
import DimensionChooser from "@/components/Dimensions/DimensionChooser";
import SelectField from "@/components/Forms/SelectField";
import Checkbox from "@/components/Radix/Checkbox";
import MetricSelector from "@/components/Experiment/MetricSelector";
import { MetricsSelectorTooltip } from "@/components/Experiment/MetricsSelector";
import ExperimentMetricsSelector from "@/components/Experiment/ExperimentMetricsSelector";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useDefinitions } from "@/services/DefinitionsContext";
import { AttributionModelTooltip } from "@/components/Experiment/AttributionModelTooltip";
import StatsEngineSelect from "@/components/Settings/forms/StatsEngineSelect";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { GBCuped, GBSequential } from "@/components/Icons";
import { hasFileConfig } from "@/services/env";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useUser } from "@/services/UserContext";
import FeatureVariationsInput from "@/components/Features/FeatureVariationsInput";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";

type TabOptions = "overview" | "metrics" | "analysis" | "variations";
export default function ConfigureReport({
  report,
  mutate,
  close,
  canEdit,
  runQueriesButtonRef,
}: {
  report: ExperimentSnapshotReportInterface;
  mutate: () => Promise<unknown> | unknown;
  close: () => void;
  canEdit?: boolean;
  runQueriesButtonRef?: RefObject<HTMLButtonElement>;
}) {
  const { getDatasourceById, segments } = useDefinitions();
  const orgSettings = useOrgSettings();
  const { hasCommercialFeature } = useUser();
  const { apiCall } = useAuth();

  const form = useForm<Partial<ExperimentSnapshotReportInterface>>({
    defaultValues: report,
  });
  const submit = form.handleSubmit(async (value) => {
    if (!canEdit) return;

    if (useToday && value.experimentAnalysisSettings) {
      value.experimentAnalysisSettings.dateEnded = null;
    }
    await apiCall<{
      updatedReport: ExperimentSnapshotReportInterface;
    }>(`/report/${report.id}`, {
      method: "PUT",
      body: JSON.stringify(value),
    });
    await mutate();
    close();
    setTimeout(() => {
      runQueriesButtonRef?.current?.click();
    }, 150);
  });

  const [tab, setTab] = useState<TabOptions>("overview");
  const [useToday, setUseToday] = useState(
    !form.watch("experimentAnalysisSettings.dateEnded")
  );

  const { data: experimentData } = useApi<{
    experiment: ExperimentInterfaceStringDates;
  }>(`/experiment/${report.experimentId}`);
  const experiment = experimentData?.experiment;

  const latestPhaseIndex = (experiment?.phases?.length ?? 1) - 1;
  const datasource = experiment?.datasource
    ? getDatasourceById(experiment.datasource)
    : null;
  const filteredSegments = segments.filter(
    (s) => s.datasource === experiment?.datasource
  );
  const datasourceProperties = datasource?.properties;
  const exposureQueries = datasource?.settings?.queries?.exposure;
  const exposureQueryId = form.watch(
    "experimentAnalysisSettings.exposureQueryId"
  );
  const exposureQuery = exposureQueries?.find((e) => e.id === exposureQueryId);

  const hasRegressionAdjustmentFeature = hasCommercialFeature(
    "regression-adjustment"
  );
  const hasSequentialTestingFeature = hasCommercialFeature(
    "sequential-testing"
  );

  const isBandit = experiment?.type === "multi-armed-bandit";

  return (
    <Modal
      open={true}
      trackingEventModalType="configure-report"
      close={close}
      header={`Edit Analysis`}
      useRadixButton={true}
      cta="Save and refresh"
      submit={submit}
      size="lg"
      bodyClassName="px-0 pt-0"
    >
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabOptions)}>
        <div
          className="position-sticky bg-white pt-1"
          style={{ top: 0, zIndex: 1, boxShadow: "var(--shadow-3)" }}
        >
          <TabsList>
            <div className="ml-3" />
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="metrics">Metrics</TabsTrigger>
            <TabsTrigger value="analysis">Analysis</TabsTrigger>
            <TabsTrigger value="variations">Variations & Traffic</TabsTrigger>
          </TabsList>
        </div>

        <div className="mx-3 mt-4">
          <TabsContent value="overview">
            <DimensionChooser
              value={form.watch("experimentAnalysisSettings.dimension") || ""}
              setValue={(v) =>
                form.setValue("experimentAnalysisSettings.dimension", v)
              }
              datasourceId={experiment?.datasource}
              exposureQueryId={form.watch(
                "experimentAnalysisSettings.exposureQueryId"
              )}
              userIdType={form.watch("experimentAnalysisSettings.userIdType")}
              newUi={false}
            />
            <SelectField
              label="Difference Type"
              value={
                form.watch("experimentAnalysisSettings.differenceType") ||
                "relative"
              }
              onChange={(v) =>
                form.setValue(
                  "experimentAnalysisSettings.differenceType",
                  v as DifferenceType
                )
              }
              sort={false}
              options={[
                {
                  label: "Relative",
                  value: "relative",
                },
                {
                  label: "Absolute",
                  value: "absolute",
                },
                {
                  label: "Scaled Impact",
                  value: "scaled",
                },
              ]}
              helpText="Choose the units to display lifts in"
            />
            <div className="d-flex" style={{ gap: "1rem" }}>
              <div style={{ width: "50%" }}>
                <DatePicker
                  label="Analysis Start (UTC)"
                  containerClassName="mb-2"
                  date={form.watch("experimentAnalysisSettings.dateStarted")}
                  setDate={(d) =>
                    form.setValue("experimentAnalysisSettings.dateStarted", d)
                  }
                  disableAfter={
                    form.watch("experimentAnalysisSettings.dateEnded") ??
                    undefined
                  }
                />
                <Button
                  variant="ghost"
                  size="sm"
                  style={{ height: 45, textAlign: "left" }}
                  onClick={() =>
                    form.setValue(
                      "experimentAnalysisSettings.dateStarted",
                      getValidDate(experiment?.phases?.[0]?.dateStarted)
                    )
                  }
                >
                  <div style={{ lineHeight: 1.25 }}>
                    Use {isBandit ? "Bandit" : "Experiment"} start date
                    <br />
                    <small>
                      {date(experiment?.phases?.[0]?.dateStarted || "")}
                    </small>
                  </div>
                </Button>
                {(experiment?.phases?.length ?? 1) > 1 ? (
                  <div className="mt-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      mt="2"
                      style={{ height: 45, textAlign: "left" }}
                      onClick={() =>
                        form.setValue(
                          "experimentAnalysisSettings.dateStarted",
                          getValidDate(
                            experiment?.phases?.[latestPhaseIndex]?.dateStarted
                          )
                        )
                      }
                    >
                      <div style={{ lineHeight: 1.25, padding: "3px 0" }}>
                        Use latest phase ({latestPhaseIndex + 1}) start date
                        <br />
                        <small>
                          {date(
                            experiment?.phases?.[latestPhaseIndex]
                              ?.dateStarted || ""
                          )}
                        </small>
                      </div>
                    </Button>
                  </div>
                ) : null}
              </div>
              <div style={{ width: "50%" }}>
                {useToday ? (
                  <Field
                    label="End (UTC)"
                    containerClassName="mb-2"
                    readOnly
                    value="today"
                    style={{ height: 38 }}
                  />
                ) : (
                  <DatePicker
                    label="End (UTC)"
                    containerClassName="mb-2"
                    date={
                      form.watch("experimentAnalysisSettings.dateEnded") ??
                      undefined
                    }
                    setDate={(d) =>
                      form.setValue("experimentAnalysisSettings.dateEnded", d)
                    }
                    disableBefore={form.watch(
                      "experimentAnalysisSettings.dateStarted"
                    )}
                  />
                )}
                <Checkbox
                  label="Today"
                  value={useToday}
                  setValue={(v) => setUseToday(v as boolean)}
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="metrics">
            <ExperimentMetricsSelector
              datasource={form.watch("experimentAnalysisSettings.datasource")}
              exposureQueryId={form.watch(
                "experimentAnalysisSettings.exposureQueryId"
              )}
              project={experiment?.project}
              forceSingleGoalMetric={experiment?.type === "multi-armed-bandit"}
              noPercentileGoalMetrics={
                experiment?.type === "multi-armed-bandit"
              }
              goalMetrics={
                form.watch("experimentAnalysisSettings.goalMetrics") ?? []
              }
              secondaryMetrics={
                form.watch("experimentAnalysisSettings.secondaryMetrics") ?? []
              }
              guardrailMetrics={
                form.watch("experimentAnalysisSettings.guardrailMetrics") ?? []
              }
              setGoalMetrics={(goalMetrics) =>
                form.setValue(
                  "experimentAnalysisSettings.goalMetrics",
                  goalMetrics
                )
              }
              setSecondaryMetrics={(secondaryMetrics) =>
                form.setValue(
                  "experimentAnalysisSettings.secondaryMetrics",
                  secondaryMetrics
                )
              }
              setGuardrailMetrics={(guardrailMetrics) =>
                form.setValue(
                  "experimentAnalysisSettings.guardrailMetrics",
                  guardrailMetrics
                )
              }
            />
            <hr className="my-4" />
            {datasourceProperties?.separateExperimentResultQueries && (
              <SelectField
                label={
                  <AttributionModelTooltip>
                    Conversion Window Override{" "}
                    <MdInfoOutline style={{ color: "#029dd1" }} />
                  </AttributionModelTooltip>
                }
                value={
                  form.watch("experimentAnalysisSettings.attributionModel") ||
                  "firstExposure"
                }
                onChange={(value) => {
                  const model = value as AttributionModel;
                  form.setValue(
                    "experimentAnalysisSettings.attributionModel",
                    model
                  );
                }}
                options={[
                  {
                    label: "Respect Conversion Windows",
                    value: "firstExposure",
                  },
                  {
                    label: "Ignore Conversion Windows",
                    value: "experimentDuration",
                  },
                ]}
              />
            )}
          </TabsContent>

          <TabsContent value="analysis">
            {exposureQueries ? (
              <SelectField
                label={
                  <>
                    Experiment Assignment Table{" "}
                    <Tooltip body="Should correspond to the Identifier Type used to randomize units for this experiment" />
                  </>
                }
                value={
                  form.watch("experimentAnalysisSettings.exposureQueryId") ?? ""
                }
                onChange={(v) =>
                  form.setValue("experimentAnalysisSettings.exposureQueryId", v)
                }
                required
                options={exposureQueries?.map((q) => {
                  return {
                    label: q.name,
                    value: q.id,
                  };
                })}
                formatOptionLabel={({ label, value }) => {
                  const userIdType = exposureQueries?.find(
                    (e) => e.id === value
                  )?.userIdType;
                  return (
                    <>
                      {label}
                      {userIdType ? (
                        <span
                          className="text-muted small float-right position-relative"
                          style={{ top: 3 }}
                        >
                          Identifier Type: <code>{userIdType}</code>
                        </span>
                      ) : null}
                    </>
                  );
                }}
              />
            ) : null}
            <Field
              label="Tracking Key"
              {...form.register(`experimentAnalysisSettings.trackingKey`)}
              helpText="Unique identifier for this Experiment, used to track impressions and analyze results"
            />
            <MetricSelector
              datasource={form.watch("experimentAnalysisSettings.datasource")}
              exposureQueryId={form.watch(
                "experimentAnalysisSettings.exposureQueryId"
              )}
              project={experiment?.project}
              includeFacts={true}
              label={
                <>
                  Activation Metric{" "}
                  <MetricsSelectorTooltip onlyBinomial={true} />
                </>
              }
              initialOption="None"
              onlyBinomial
              value={
                form.watch("experimentAnalysisSettings.activationMetric") || ""
              }
              onChange={(value) =>
                form.setValue(
                  "experimentAnalysisSettings.activationMetric",
                  value || ""
                )
              }
              helpText="Users must convert on this metric before being included"
            />
            {datasourceProperties?.experimentSegments && (
              <SelectField
                label="Segment"
                value={form.watch("experimentAnalysisSettings.segment") || ""}
                onChange={(value) =>
                  form.setValue(
                    "experimentAnalysisSettings.segment",
                    value || ""
                  )
                }
                initialOption="None (All Users)"
                options={filteredSegments.map((s) => {
                  return {
                    label: s.name,
                    value: s.id,
                  };
                })}
                helpText="Only users in this segment will be included"
              />
            )}
            {datasourceProperties?.separateExperimentResultQueries && (
              <SelectField
                label="Metric Conversion Windows"
                value={
                  form.watch("experimentAnalysisSettings.skipPartialData")
                    ? "strict"
                    : "loose"
                }
                onChange={(v) => {
                  form.setValue(
                    "experimentAnalysisSettings.skipPartialData",
                    v === "strict"
                  );
                }}
                options={[
                  {
                    label: "Include In-Progress Conversions",
                    value: "loose",
                  },
                  {
                    label: "Exclude In-Progress Conversions",
                    value: "strict",
                  },
                ]}
                helpText="How to treat users not enrolled in the experiment long enough to complete conversion window."
              />
            )}

            <hr className="my-4" />

            <StatsEngineSelect
              value={form.watch("experimentAnalysisSettings.statsEngine")}
              onChange={(v) => {
                form.setValue("experimentAnalysisSettings.statsEngine", v);
              }}
              allowUndefined={false}
              className=""
            />
            <SelectField
              label={
                <PremiumTooltip commercialFeature="regression-adjustment">
                  <GBCuped className="mr-1" />
                  Use Regression Adjustment (CUPED)
                </PremiumTooltip>
              }
              value={
                form.watch(
                  "experimentAnalysisSettings.regressionAdjustmentEnabled"
                )
                  ? "on"
                  : "off"
              }
              onChange={(v) => {
                form.setValue(
                  "experimentAnalysisSettings.regressionAdjustmentEnabled",
                  v === "on"
                );
              }}
              options={[
                {
                  label: "On",
                  value: "on",
                },
                {
                  label: "Off",
                  value: "off",
                },
              ]}
              disabled={!hasRegressionAdjustmentFeature}
            />
            {form.watch("experimentAnalysisSettings.statsEngine") ===
              "frequentist" && (
              <div className="d-flex" style={{ gap: "1rem" }}>
                <div className="flex-1">
                  <SelectField
                    label={
                      <PremiumTooltip commercialFeature="sequential-testing">
                        <GBSequential className="mr-1" />
                        Use Sequential Testing
                      </PremiumTooltip>
                    }
                    value={
                      form.watch(
                        "experimentAnalysisSettings.sequentialTestingEnabled"
                      )
                        ? "on"
                        : "off"
                    }
                    onChange={(v) => {
                      form.setValue(
                        "experimentAnalysisSettings.sequentialTestingEnabled",
                        v === "on"
                      );
                    }}
                    options={[
                      {
                        label: "On",
                        value: "on",
                      },
                      {
                        label: "Off",
                        value: "off",
                      },
                    ]}
                    helpText="Only applicable to Frequentist analyses"
                    disabled={!hasSequentialTestingFeature}
                  />
                </div>
                {form.watch(
                  "experimentAnalysisSettings.sequentialTestingEnabled"
                ) ? (
                  <div style={{ width: 250 }}>
                    <Field
                      label="Tuning parameter"
                      type="number"
                      min="0"
                      disabled={!hasSequentialTestingFeature || hasFileConfig()}
                      helpText={
                        <>
                          <span className="ml-2">
                            (
                            {orgSettings.sequentialTestingTuningParameter ??
                              DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER}{" "}
                            is organization default)
                          </span>
                        </>
                      }
                      {...form.register(
                        "experimentAnalysisSettings.sequentialTestingTuningParameter",
                        {
                          valueAsNumber: true,
                          validate: (v) => {
                            // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
                            return !(v <= 0);
                          },
                        }
                      )}
                    />
                  </div>
                ) : null}
              </div>
            )}

            <hr className="mt-2 mb-4" />

            {datasourceProperties?.queryLanguage === "sql" && (
              <div className="row mt-4">
                <div className="col pr-3">
                  <Field
                    label="Custom SQL Filter"
                    labelClassName="font-weight-bold"
                    {...form.register("experimentAnalysisSettings.queryFilter")}
                    textarea
                    placeholder="e.g. user_id NOT IN ('123', '456')"
                    helpText="WHERE clause to add to the default experiment query"
                  />
                </div>
                <div className="pt-2 pl-3 border-left col-sm-4 col-lg-6">
                  Available columns:
                  <div className="mb-2 d-flex flex-wrap">
                    {["timestamp", "variation_id"]
                      .concat(exposureQuery ? [exposureQuery.userIdType] : [])
                      .concat(exposureQuery?.dimensions || [])
                      .map((d) => {
                        return (
                          <div className="mr-2 mb-2 border px-1" key={d}>
                            <code>{d}</code>
                          </div>
                        );
                      })}
                  </div>
                  <div>
                    <strong>Tip:</strong> Use a subquery inside an{" "}
                    <code>IN</code> or <code>NOT IN</code> clause for more
                    advanced filtering.
                  </div>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="variations">
            <FeatureVariationsInput
              label={null}
              coverageTooltip="Used to compute scaled impact (Difference type: scaled)"
              setWeight={(i, weight) => {
                form.setValue(
                  `experimentMetadata.phases.${latestPhaseIndex}.variationWeights.${i}`,
                  weight
                );
              }}
              variations={
                form.watch("experimentMetadata.variations")?.map((v, i) => {
                  return {
                    value: v.key || "",
                    name: v.name,
                    weight: form.watch(
                      `experimentMetadata.phases.${latestPhaseIndex}.variationWeights.${i}`
                    ),
                    id: v.id,
                  };
                }) ?? []
              }
              setVariations={(v) => {
                form.setValue(
                  "experimentMetadata.variations",
                  v.map((data) => {
                    const { value, ...newData } = data;
                    return {
                      // default values
                      name: "",
                      description: "",
                      screenshots: [],
                      ...newData,
                      key: value,
                    };
                  })
                );
                form.setValue(
                  `experimentMetadata.phases.${latestPhaseIndex}.variationWeights`,
                  v.map((v) => v.weight)
                );
              }}
              coverage={form.watch(
                `experimentMetadata.phases.${latestPhaseIndex}.coverage`
              )}
              setCoverage={(c) =>
                form.setValue(
                  `experimentMetadata.phases.${latestPhaseIndex}.coverage`,
                  c
                )
              }
              showPreview={false}
              showDescriptions={false}
            />
          </TabsContent>
        </div>
      </Tabs>
    </Modal>
  );
}
