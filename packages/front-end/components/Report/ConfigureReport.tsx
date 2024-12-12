import { ExperimentSnapshotReportInterface } from "back-end/types/report";
import Collapsible from "react-collapsible";
import React, { RefObject, useState } from "react";
import { useForm } from "react-hook-form";
import {
  AttributionModel,
  ExperimentInterfaceStringDates,
} from "back-end/types/experiment";
import { Flex, Grid } from "@radix-ui/themes";
import { FaGear } from "react-icons/fa6";
import { date, getValidDate } from "shared/dates";
import Link from "next/link";
import { FaExternalLinkAlt } from "react-icons/fa";
import { DifferenceType } from "back-end/types/stats";
import { MdInfoOutline } from "react-icons/md";
import { DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER } from "shared/constants";
import { BsArrowRepeat } from "react-icons/bs";
import StatusIndicator from "@/components/Experiment/StatusIndicator";
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
import HelperText from "@/components/Radix/HelperText";

type TabOptions = "overview" | "metrics" | "analysis" | "variations";
export default function ConfigureReport({
  report,
  mutate,
  open,
  setOpen,
  canEdit,
  runQueriesButtonRef,
}: {
  report: ExperimentSnapshotReportInterface;
  mutate: () => Promise<unknown> | unknown;
  open: boolean;
  setOpen: (o: boolean) => void;
  canEdit?: boolean;
  runQueriesButtonRef?: RefObject<HTMLButtonElement>;
}) {
  const { getDatasourceById, segments } = useDefinitions();
  const orgSettings = useOrgSettings();
  const { hasCommercialFeature } = useUser();
  const { apiCall } = useAuth();

  const form = useForm({
    defaultValues: report,
  });
  const submit = form.handleSubmit(async (value) => {
    if (!canEdit) return;

    if (useToday) {
      value.experimentAnalysisSettings.dateEnded = null;
    }
    await apiCall<{
      updatedReport: ExperimentSnapshotReportInterface;
    }>(`/report/${report.id}`, {
      method: "PUT",
      body: JSON.stringify(value),
    });
    await mutate();
    setOpen(false);
    setTimeout(() => {
      runQueriesButtonRef?.current?.click();
    }, 150);
  });

  const [tab, setTab] = useState<TabOptions>("overview");
  const [useToday, setUseToday] = useState(
    !form.watch("experimentAnalysisSettings.dateEnded")
  );
  const [loading, setLoading] = useState(false);
  const [saveError, setSaveError] = useState("");

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

  return (
    <div className="bg-white mb-2">
      <Collapsible
        // @ts-expect-error - state managed by external button
        trigger={null}
        open={open}
        transitionTime={100}
      >
        <div
          className="drawer border-bottom pt-0 pb-3 px-3"
          style={{
            backgroundColor: "var(--iris-a3)",
            boxShadow: "0 6px 8px -4px #00000008 inset",
          }}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (loading) return;
              setSaveError("");
              setLoading(true);
              try {
                await submit();
              } catch (e) {
                setSaveError(e.message);
              }
              setLoading(false);
            }}
          >
            <Tabs value={tab} onValueChange={(v) => setTab(v as TabOptions)}>
              <div className="d-flex align-items-start w-100 pt-2 mb-3">
                <TabsList style={{ width: "100%" }}>
                  <div
                    className="h5 my-0 mr-4 d-flex align-items-center position-relative"
                    style={{ top: 1 }}
                  >
                    <FaGear className="mr-2" />
                    Configure Report
                  </div>
                  <TabsTrigger value="overview">Overview</TabsTrigger>

                  <TabsTrigger value="metrics">Metrics</TabsTrigger>
                  <TabsTrigger value="analysis">Analysis</TabsTrigger>
                  <TabsTrigger value="variations">
                    Variations & Traffic
                  </TabsTrigger>
                  {/*<div className="flex-1" />*/}
                </TabsList>
              </div>

              <TabsContent value="overview">
                <Grid columns="2" gap="6" mb="4">
                  <div>
                    <label>
                      Report based on{" "}
                      {experiment?.type === "multi-armed-bandit"
                        ? "Bandit"
                        : "Experiment"}
                      :
                    </label>
                    <div className="box rounded bg-light py-2 px-3">
                      {experiment ? (
                        <>
                          <div>
                            <>
                              <span className="mr-2">{experiment?.name}</span>
                              <Link
                                href={`/${
                                  experiment?.type === "multi-armed-bandit"
                                    ? "bandit"
                                    : "experiment"
                                }/${experiment?.id}`}
                              >
                                <FaExternalLinkAlt size={12} />
                              </Link>
                            </>
                          </div>
                          <div className="small d-flex flex-wrap mt-1">
                            <div className="text-muted">
                              Created: {date(experiment?.dateCreated)}
                            </div>
                            <div className="ml-3 d-flex align-items-center">
                              <StatusIndicator
                                archived={experiment?.archived}
                                status={experiment?.status}
                              />
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="text-muted">No experiment found</div>
                      )}
                    </div>
                  </div>
                </Grid>
                <Flex wrap="wrap" gap="6">
                  <div className="flex-1" style={{ minWidth: 200 }}>
                    <DimensionChooser
                      value={
                        form.watch("experimentAnalysisSettings.dimension") || ""
                      }
                      setValue={(v) =>
                        form.setValue("experimentAnalysisSettings.dimension", v)
                      }
                      datasourceId={experiment?.datasource}
                      exposureQueryId={form.watch(
                        "experimentAnalysisSettings.exposureQueryId"
                      )}
                      userIdType={form.watch(
                        "experimentAnalysisSettings.userIdType"
                      )}
                      newUi={false}
                    />
                  </div>
                  <div className="flex-1" style={{ minWidth: 200 }}>
                    <SelectField
                      label="Difference Type"
                      value={
                        form.watch(
                          "experimentAnalysisSettings.differenceType"
                        ) || "relative"
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
                  </div>
                  <div className="flex-1" style={{ minWidth: 380 }}>
                    <div className="d-flex" style={{ gap: "1rem" }}>
                      <div>
                        <DatePicker
                          label="Analysis Start (UTC)"
                          containerClassName="mb-2"
                          date={form.watch(
                            "experimentAnalysisSettings.dateStarted"
                          )}
                          setDate={(d) =>
                            form.setValue(
                              "experimentAnalysisSettings.dateStarted",
                              d
                            )
                          }
                          disableAfter={
                            form.watch(
                              "experimentAnalysisSettings.dateEnded"
                            ) ?? undefined
                          }
                          inputWidth={180}
                        />
                        <Button
                          variant="soft"
                          size="xs"
                          style={{ height: "auto", textAlign: "left" }}
                          onClick={() =>
                            form.setValue(
                              "experimentAnalysisSettings.dateStarted",
                              getValidDate(experiment?.phases?.[0]?.dateStarted)
                            )
                          }
                        >
                          <div style={{ lineHeight: 1.25, padding: "3px 0" }}>
                            Experiment start
                            <br />
                            <small>
                              {date(experiment?.phases?.[0]?.dateStarted || "")}
                            </small>
                          </div>
                        </Button>
                        {(experiment?.phases?.length ?? 1) > 1 ? (
                          <Button
                            variant="soft"
                            size="xs"
                            mt="2"
                            style={{ height: "auto", textAlign: "left" }}
                            onClick={() =>
                              form.setValue(
                                "experimentAnalysisSettings.dateStarted",
                                getValidDate(
                                  experiment?.phases?.[latestPhaseIndex]
                                    ?.dateStarted
                                )
                              )
                            }
                          >
                            <div style={{ lineHeight: 1.25, padding: "3px 0" }}>
                              Latest phase ({latestPhaseIndex + 1}) start
                              <br />
                              <small>
                                {date(
                                  experiment?.phases?.[latestPhaseIndex]
                                    ?.dateStarted || ""
                                )}
                              </small>
                            </div>
                          </Button>
                        ) : null}
                      </div>
                      <div>
                        {useToday ? (
                          <Field
                            label="End (UTC)"
                            containerClassName="mb-2"
                            readOnly
                            value="today"
                            style={{ width: 180, height: 38 }}
                          />
                        ) : (
                          <DatePicker
                            label="End (UTC)"
                            containerClassName="mb-2"
                            date={
                              form.watch(
                                "experimentAnalysisSettings.dateEnded"
                              ) ?? undefined
                            }
                            setDate={(d) =>
                              form.setValue(
                                "experimentAnalysisSettings.dateEnded",
                                d
                              )
                            }
                            disableBefore={form.watch(
                              "experimentAnalysisSettings.dateStarted"
                            )}
                            inputWidth={180}
                          />
                        )}
                        <Checkbox
                          label="Today"
                          value={useToday}
                          setValue={(v) => setUseToday(v as boolean)}
                        />
                      </div>
                    </div>
                  </div>
                </Flex>
              </TabsContent>

              <TabsContent value="metrics">
                <Flex wrap="wrap" gap="6">
                  <ExperimentMetricsSelector
                    datasource={form.watch(
                      "experimentAnalysisSettings.datasource"
                    )}
                    exposureQueryId={form.watch(
                      "experimentAnalysisSettings.exposureQueryId"
                    )}
                    project={experiment?.project}
                    forceSingleGoalMetric={
                      experiment?.type === "multi-armed-bandit"
                    }
                    noPercentileGoalMetrics={
                      experiment?.type === "multi-armed-bandit"
                    }
                    goalMetrics={
                      form.watch("experimentAnalysisSettings.goalMetrics") ?? []
                    }
                    secondaryMetrics={
                      form.watch(
                        "experimentAnalysisSettings.secondaryMetrics"
                      ) ?? []
                    }
                    guardrailMetrics={
                      form.watch(
                        "experimentAnalysisSettings.guardrailMetrics"
                      ) ?? []
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
                </Flex>
                <Flex wrap="wrap" gap="6">
                  <div className="flex-1">
                    <MetricSelector
                      datasource={form.watch(
                        "experimentAnalysisSettings.datasource"
                      )}
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
                        form.watch(
                          "experimentAnalysisSettings.activationMetric"
                        ) || ""
                      }
                      onChange={(value) =>
                        form.setValue(
                          "experimentAnalysisSettings.activationMetric",
                          value || ""
                        )
                      }
                      helpText="Users must convert on this metric before being included"
                    />
                  </div>
                  {datasourceProperties?.separateExperimentResultQueries && (
                    <div className="flex-1">
                      <SelectField
                        label={
                          <AttributionModelTooltip>
                            Conversion Window Override{" "}
                            <MdInfoOutline style={{ color: "#029dd1" }} />
                          </AttributionModelTooltip>
                        }
                        value={
                          form.watch(
                            "experimentAnalysisSettings.attributionModel"
                          ) || "firstExposure"
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
                    </div>
                  )}
                  <div className="flex-1" />
                </Flex>
              </TabsContent>

              <TabsContent value="analysis">
                <Flex wrap="wrap" gap="6">
                  <div className="flex-1">
                    <Field
                      label="Tracking Key"
                      {...form.register(
                        `experimentAnalysisSettings.trackingKey`
                      )}
                      helpText="Unique identifier for this Experiment, used to track impressions and analyze results"
                    />
                  </div>
                  {exposureQueries ? (
                    <div className="flex-1">
                      <SelectField
                        label={
                          <>
                            Experiment Assignment Table{" "}
                            <Tooltip body="Should correspond to the Identifier Type used to randomize units for this experiment" />
                          </>
                        }
                        value={
                          form.watch(
                            "experimentAnalysisSettings.exposureQueryId"
                          ) ?? ""
                        }
                        onChange={(v) =>
                          form.setValue(
                            "experimentAnalysisSettings.exposureQueryId",
                            v
                          )
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
                    </div>
                  ) : null}
                </Flex>
                <Flex wrap="wrap" gap="6">
                  {datasourceProperties?.experimentSegments && (
                    <div className="flex-1">
                      <SelectField
                        label="Segment"
                        value={
                          form.watch("experimentAnalysisSettings.segment") || ""
                        }
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
                    </div>
                  )}
                  {datasourceProperties?.separateExperimentResultQueries && (
                    <div className="flex-1">
                      <SelectField
                        label="Handling In-Progress Conversions"
                        value={
                          form.watch(
                            "experimentAnalysisSettings.skipPartialData"
                          )
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
                    </div>
                  )}
                </Flex>
                {datasourceProperties?.queryLanguage === "sql" && (
                  <div className="row">
                    <div className="col pr-3">
                      <Field
                        label="Custom SQL Filter"
                        labelClassName="font-weight-bold"
                        {...form.register(
                          "experimentAnalysisSettings.queryFilter"
                        )}
                        textarea
                        placeholder="e.g. user_id NOT IN ('123', '456')"
                        helpText="WHERE clause to add to the default experiment query"
                      />
                    </div>
                    <div className="pt-2 pl-3 border-left col-sm-4 col-lg-6">
                      Available columns:
                      <div className="mb-2 d-flex flex-wrap">
                        {["timestamp", "variation_id"]
                          .concat(
                            exposureQuery ? [exposureQuery.userIdType] : []
                          )
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

                <hr />

                <Flex wrap="wrap" gap="6">
                  <div className="flex-1">
                    <StatsEngineSelect
                      value={form.watch(
                        "experimentAnalysisSettings.statsEngine"
                      )}
                      onChange={(v) => {
                        form.setValue(
                          "experimentAnalysisSettings.statsEngine",
                          v
                        );
                      }}
                      allowUndefined={false}
                      className=""
                    />
                  </div>
                  {form.watch("experimentAnalysisSettings.statsEngine") ===
                    "frequentist" && (
                    <div className="flex-1">
                      <div className="d-flex" style={{ gap: "1rem" }}>
                        <div className="flex-1">
                          <SelectField
                            label={
                              <PremiumTooltip commercialFeature="sequential-testing">
                                <GBSequential /> Use Sequential Testing
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
                          <div>
                            <Field
                              label="Tuning parameter"
                              type="number"
                              min="0"
                              disabled={
                                !hasSequentialTestingFeature || hasFileConfig()
                              }
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
                    </div>
                  )}
                  <div className="flex-1">
                    <SelectField
                      label={
                        <PremiumTooltip commercialFeature="regression-adjustment">
                          <GBCuped /> Use Regression Adjustment (CUPED)
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
                  </div>
                </Flex>
              </TabsContent>

              <TabsContent value="variations">
                <Flex wrap="wrap" gap="6">
                  <div style={{ width: 600 }}>
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
                        form
                          .watch("experimentMetadata.variations")
                          ?.map((v, i) => {
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
                      sortableClassName="bg-highlight border"
                    />
                  </div>
                </Flex>
              </TabsContent>
            </Tabs>

            <div className="d-flex border-top pt-3 mt-2 align-items-center justify-content-end">
              {!!saveError && (
                <HelperText status="error">{saveError}</HelperText>
              )}
              <Button icon={<BsArrowRepeat />} type="submit" ml="4">
                Save and refresh
              </Button>
            </div>
          </form>
        </div>
      </Collapsible>
    </div>
  );
}
