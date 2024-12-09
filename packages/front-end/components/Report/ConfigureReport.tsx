import { ExperimentSnapshotReportInterface } from "back-end/types/report";
import Collapsible from "react-collapsible";
import React, { useState } from "react";
import { useForm } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "back-end/types/experiment";
import { IdeaInterface } from "back-end/types/idea";
import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import { URLRedirectInterface } from "back-end/types/url-redirect";
import {Flex, Grid} from "@radix-ui/themes";
import { PiClock, PiX } from "react-icons/pi";
import { FaGear } from "react-icons/fa6";
import { date } from "shared/dates";
import Link from "next/link";
import { FaExternalLinkAlt } from "react-icons/fa";
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
import {DifferenceType} from "back-end/types/stats";
import SelectField from "@/components/Forms/SelectField";
import Checkbox from "@/components/Radix/Checkbox";
import MetricSelector from "@/components/Experiment/MetricSelector";
import {MetricsSelectorTooltip} from "@/components/Experiment/MetricsSelector";
import ExperimentMetricsSelector from "@/components/Experiment/ExperimentMetricsSelector";

type TabOptions = "overview" | "metrics" | "analysis" | "variations";
export default function ConfigureReport({
  report,
  mutate,
  open,
  setOpen,
}: {
  report: ExperimentSnapshotReportInterface;
  mutate: () => void;
  open: boolean;
  setOpen: (o: boolean) => void;
}) {
  const { data: experimentData } = useApi<{
    experiment: ExperimentInterfaceStringDates;
  }>(`/experiment/${report.experimentId}`);
  const experiment = experimentData?.experiment;
  const latestPhaseIndex = (experiment?.phases?.length ?? 1) -1;

  const form = useForm({
    defaultValues: report,
  });
  const [tab, setTab] = useState<TabOptions>("overview");
  const [useToday, setUseToday] = useState(!form.watch("experimentAnalysisSettings.dateEnded"));

  return (
    <div className="bg-white">
      <Collapsible
        // @ts-expect-error - state managed by external button
        trigger={null}
        open={open}
        transitionTime={100}
      >
        <div
          className="drawer border border-bottom-0 pt-0 pb-3 px-3"
          style={{
            backgroundColor: "var(--iris-a3)",
            boxShadow: "0 -6px 8px -4px #00000011 inset",
          }}
        >
          <Tabs value={tab} onValueChange={(v) => setTab(v as TabOptions)}>
            <div className="d-flex align-items-start pt-2">
              <TabsList mb="3" mt="1" style={{ width: "calc(100% - 50px" }}>
                <div
                  className="h5 my-0 mr-4 d-flex align-items-center position-relative"
                  style={{ top: 1 }}
                >
                  <FaGear className="mr-2" />
                  Configuration
                </div>
                <TabsTrigger value="overview">Overview</TabsTrigger>

                <TabsTrigger value="metrics">Metrics</TabsTrigger>
                <TabsTrigger value="analysis">Analysis</TabsTrigger>
                <TabsTrigger value="variations">
                  Variations & Traffic
                </TabsTrigger>
                <div className="flex-1" />
              </TabsList>
              <div className="flex-1" />
              <div className="mt-2 position-relative" style={{ top: 2.5 }}>
                <Button
                  variant="soft"
                  color="gray"
                  size="sm"
                  onClick={() => setOpen(false)}
                >
                  <PiX />
                </Button>
              </div>
            </div>

            <TabsContent value="overview">
              <Grid columns="2" gap="6" mb="4">
                <div>
                  <label>
                    Report based on{" "}
                    {experiment?.type === "multi-armed-bandit"
                      ? "Bandit"
                      : "Experiment"}:
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
                    value={form.watch("experimentAnalysisSettings.dimension") || ""}
                    setValue={(v) => form.setValue("experimentAnalysisSettings.dimension", v)}
                    datasourceId={experiment?.datasource}
                    exposureQueryId={form.watch("experimentAnalysisSettings.exposureQueryId")}
                    userIdType={form.watch("experimentAnalysisSettings.userIdType")}
                    newUi={false}
                  />
                </div>
                <div className="flex-1" style={{minWidth: 200}}>
                  <SelectField
                    label="Difference Type"
                    value={form.watch("experimentAnalysisSettings.differenceType") || "relative"}
                    onChange={(v) => form.setValue("experimentAnalysisSettings.differenceType", v as DifferenceType)}
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
                <div className="flex-1" style={{minWidth: 380}}>
                  <div className="d-flex" style={{gap: "1rem"}}>
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
                        disableAfter={form.watch(
                          "experimentAnalysisSettings.dateEnded"
                        )}
                        inputWidth={180}
                      />
                      <Button
                        variant="soft" size="xs"
                        style={{ height: "auto", textAlign: "left" }}
                        onClick={() => form.setValue("experimentAnalysisSettings.dateStarted", experiment.phases[0].dateStarted)}
                      >
                        <div style={{lineHeight: 1.25, padding: "3px 0"}}>
                          Experiment start<br/>
                          <small>{date(experiment.phases[0].dateStarted)}</small>
                        </div>
                      </Button>
                      {(experiment?.phases?.length ?? 1) > 1 ? (
                        <Button
                          variant="soft" size="xs" mt="2"
                          style={{ height: "auto", textAlign: "left" }}
                          onClick={() => form.setValue("experimentAnalysisSettings.dateStarted", experiment.phases[latestPhaseIndex].dateStarted)}
                        >
                          <div style={{ lineHeight: 1.25, padding: "3px 0" }}>
                            Latest phase ({latestPhaseIndex + 1}) start<br />
                            <small>{date(experiment.phases[latestPhaseIndex].dateStarted)}</small>
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
                          date={form.watch("experimentAnalysisSettings.dateEnded")}
                          setDate={(d) =>
                            form.setValue("experimentAnalysisSettings.dateEnded", d)
                          }
                          disableBefore={form.watch(
                            "experimentAnalysisSettings.dateStarted"
                          )}
                          inputWidth={180}
                        />
                      )}
                      <Checkbox label="Today" value={useToday} setValue={(v) => setUseToday(v)} />
                    </div>
                  </div>
                </div>
              </Flex>
            </TabsContent>

            <TabsContent value="metrics">
              <Flex wrap="wrap" gap="6">
                <MetricSelector
                  datasource={form.watch("experimentAnalysisSettings.datasource")}
                  exposureQueryId={form.watch("experimentAnalysisSettings.exposureQueryId")}
                  project={experiment?.project}
                  includeFacts={true}
                  label={
                    <>
                      Activation Metric <MetricsSelectorTooltip onlyBinomial={true} />
                    </>
                  }
                  initialOption="None"
                  onlyBinomial
                  value={form.watch("experimentAnalysisSettings.activationMetric") || ""}
                  onChange={(value) => form.setValue("experimentAnalysisSettings.activationMetric", value || "")}
                  helpText="Users must convert on this metric before being included"
                />
              </Flex>
              <Flex wrap="wrap" gap="6">
                <ExperimentMetricsSelector
                  datasource={form.watch("experimentAnalysisSettings.datasource")}
                  exposureQueryId={form.watch("experimentAnalysisSettings.exposureQueryId")}
                  project={experiment?.project}
                  forceSingleGoalMetric={experiment?.type === "multi-armed-bandit"}
                  noPercentileGoalMetrics={experiment?.type === "multi-armed-bandit"}
                  goalMetrics={form.watch("experimentAnalysisSettings.goalMetrics") ?? []}
                  secondaryMetrics={form.watch("experimentAnalysisSettings.secondaryMetrics") ?? []}
                  guardrailMetrics={form.watch("experimentAnalysisSettings.guardrailMetrics") ?? []}
                  setGoalMetrics={(goalMetrics) =>
                    form.setValue("experimentAnalysisSettings.goalMetrics", goalMetrics)
                  }
                  setSecondaryMetrics={(secondaryMetrics) =>
                    form.setValue("experimentAnalysisSettings.secondaryMetrics", secondaryMetrics)
                  }
                  setGuardrailMetrics={(guardrailMetrics) =>
                    form.setValue("experimentAnalysisSettings.guardrailMetrics", guardrailMetrics)
                  }
                />
              </Flex>
            </TabsContent>

            <TabsContent value="analysis">
              <Flex wrap="wrap" gap="6">
                <Field
                  label="Tracking Key"
                  {...form.register(`experimentAnalysisSettings.trackingKey`)}
                  helpText="Unique identifier for this Experiment, used to track impressions and analyze results"
                />
              </Flex>
            </TabsContent>

            <TabsContent value="variations">
              <Flex wrap="wrap" gap="6">
              </Flex>
            </TabsContent>
          </Tabs>
        </div>
      </Collapsible>
    </div>
  );
}
