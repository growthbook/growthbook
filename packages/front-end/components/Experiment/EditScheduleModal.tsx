import { useForm } from "react-hook-form";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { Box, Flex, Grid, Text as RadixText } from "@radix-ui/themes";
import { format as formatTimeZone } from "date-fns-tz";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import DatePicker from "@/components/DatePicker";
import { useAuth } from "@/services/auth";
import Text from "@/ui/Text";
import Helpertext from "@/ui/HelperText";
import Button from "@/ui/Button";
import SelectField from "@/components/Forms/SelectField";
import Field from "@/components/Forms/Field";
import Switch from "@/ui/Switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";

type EndStrategyType = "none" | "soft" | "soft-edf" | "hard-planned";

interface FormValues {
  statusUpdateSchedule: {
    startAt: string;
  };
  ramp: {
    enabled: boolean;
    endStrategyType: EndStrategyType;
    endDate: string;
    plannedVariationId: string;
    onRollbackNow: "hold" | "rollback";
    onShipNow: "advance-and-prompt" | "ship";
    onReviewNow: "hold" | "rollback";
    srmAction: "hold" | "rollback" | "warn";
    multipleExposureAction: "hold" | "rollback" | "warn";
    noTrafficAction: "hold" | "rollback" | "warn";
    noTrafficGracePeriodHours: number;
  };
}

export default function EditScheduleModal({
  experiment,
  mutate,
  close,
}: {
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  close: () => void;
}) {
  const form = useForm<FormValues>({
    defaultValues: {
      statusUpdateSchedule: {
        startAt: experiment.statusUpdateSchedule?.startAt ?? "",
      },
      ramp: {
        enabled: !!experiment.rampScheduleId,
        endStrategyType: "none",
        endDate: "",
        plannedVariationId: "",
        onRollbackNow: "hold",
        onShipNow: "advance-and-prompt",
        onReviewNow: "hold",
        srmAction: "hold",
        multipleExposureAction: "hold",
        noTrafficAction: "hold",
        noTrafficGracePeriodHours: 24,
      },
    },
  });

  const { apiCall } = useAuth();

  const now = new Date();
  const hasSchedule = !!experiment.statusUpdateSchedule?.startAt;
  const isApproved = !!experiment.nextScheduledStatusUpdate;
  const scheduleIsInThePast =
    experiment.statusUpdateSchedule?.startAt &&
    new Date(experiment.statusUpdateSchedule.startAt) < now;

  const rampEnabled = form.watch("ramp.enabled");
  const endStrategyType = form.watch("ramp.endStrategyType");
  const hasRampSchedule = !!experiment.rampScheduleId;

  const handleSubmit = form.handleSubmit(async (data) => {
    // Update start schedule
    await apiCall(`/experiment/${experiment.id}`, {
        method: "POST",
        body: JSON.stringify({
          statusUpdateSchedule: data.statusUpdateSchedule.startAt
            ? { startAt: data.statusUpdateSchedule.startAt }
            : null,
        }),
      });

      // Update/create ramp schedule if toggled on
      if (rampEnabled) {
        const monitoringBehavior = {
          onRollbackNow: data.ramp.onRollbackNow,
          onShipNow: data.ramp.onShipNow,
          onReviewNow: data.ramp.onReviewNow,
          srmAction: data.ramp.srmAction,
          multipleExposureAction: data.ramp.multipleExposureAction,
          noTrafficAction: data.ramp.noTrafficAction,
          noTrafficGracePeriodHours: data.ramp.noTrafficGracePeriodHours,
        };
        const endStrategy =
          data.ramp.endStrategyType !== "none"
            ? {
                type: data.ramp.endStrategyType,
                date: data.ramp.endDate || undefined,
                plannedVariationId:
                  data.ramp.endStrategyType === "hard-planned"
                    ? data.ramp.plannedVariationId
                    : undefined,
              }
            : undefined;

        if (!hasRampSchedule) {
          // Create a new ramp schedule with a single initial step
          await apiCall(`/experiment/${experiment.id}/ramp-schedule`, {
            method: "POST",
            body: JSON.stringify({
              name: `${experiment.name} Ramp`,
              steps: [
                {
                  interval: 7 * 24 * 3600, // 7 days
                  actions: [
                    {
                      targetType: "experiment",
                      targetId: experiment.id,
                      patch: { coverage: 0.1 },
                    },
                  ],
                  monitored: true,
                },
              ],
              monitoringBehavior,
              endStrategy,
            }),
          });
        } else {
          // Update monitoring behavior / end strategy
          await apiCall(`/experiment/${experiment.id}/ramp-schedule`, {
            method: "PUT",
            body: JSON.stringify({ monitoringBehavior, endStrategy }),
          });
        }
      } else if (hasRampSchedule) {
        // Disable ramp (delete if not running)
        await apiCall(`/experiment/${experiment.id}/ramp-schedule`, {
          method: "DELETE",
        }).catch(() => {
          // Ignore — may be running; user must pause first
        });
      }

    mutate();
    close();
  });

  return (
    <ModalStandard
      trackingEventModalType="edit-schedule-modal"
      trackingEventModalSource="eid"
      open={true}
      close={close}
      header="Launch Settings"
      subheader="Configure when and how this experiment launches and ramps up traffic."
      cta="Save"
      ctaColor="violet"
      size="lg"
      secondaryAction={
        isApproved ? (
          <Button
            variant="ghost"
            color="red"
            onClick={async () => {
              await apiCall(`/experiment/${experiment.id}/unschedule-start`, {
                method: "POST",
              });
              mutate();
              close();
            }}
          >
            Unschedule Experiment
          </Button>
        ) : undefined
      }
      submit={handleSubmit}
    >
      <Tabs defaultValue="schedule">
        <TabsList>
          <TabsTrigger value="schedule">Start Date</TabsTrigger>
          <TabsTrigger value="ramp">
            Ramp Schedule{" "}
            {hasRampSchedule && (
              <Badge color="indigo" ml="1" label="Active" />
            )}
          </TabsTrigger>
          <TabsTrigger value="end">End Strategy</TabsTrigger>
          <TabsTrigger value="monitoring">Monitoring</TabsTrigger>
        </TabsList>

        {/* ── Start Date tab ── */}
        <TabsContent value="schedule">
          <Box mt="4">
            <Text as="label" color="text-high" mb={hasSchedule ? "1" : "2"}>
              Start Date & Time{" "}
              <Text as="span" color="text-mid">
                ({formatTimeZone(new Date(), "z")})
              </Text>
            </Text>
            {hasSchedule && (
              <Text as="div" color="text-mid" mb="2">
                Leave empty to remove schedule.
              </Text>
            )}
            <DatePicker
              containerClassName=""
              clearButton
              label=""
              date={form.watch("statusUpdateSchedule.startAt")}
              disableBefore={now}
              setDate={(v) => {
                form.setValue(
                  "statusUpdateSchedule.startAt",
                  v ? v.toISOString() : "",
                );
              }}
            />
            {scheduleIsInThePast && (
              <Helpertext mt="2" status="warning">
                Scheduled time has passed
              </Helpertext>
            )}
          </Box>
        </TabsContent>

        {/* ── Ramp Schedule tab ── */}
        <TabsContent value="ramp">
          <Box mt="4">
            <Flex align="center" gap="3" mb="4">
              <Switch
                value={rampEnabled}
                onChange={(v) => form.setValue("ramp.enabled", v)}
              />
              <Text as="label" htmlFor="ramp-enabled" color="text-high">
                Enable traffic ramp schedule
              </Text>
            </Flex>

            {rampEnabled && !hasRampSchedule && (
              <Callout status="info" mb="4">
                A default ramp schedule will be created with a single 7-day
                monitored step at 10% coverage. You can edit the steps after
                saving.
              </Callout>
            )}

            {rampEnabled && hasRampSchedule && (
              <Callout status="success" mb="4">
                A ramp schedule is active. Monitoring behavior and end strategy
                settings below apply to this ramp.
              </Callout>
            )}

            {!rampEnabled && hasRampSchedule && (
              <Callout status="warning" mb="4">
                Disabling will attempt to delete the existing ramp schedule.
                Running schedules cannot be deleted — pause it first.
              </Callout>
            )}
          </Box>
        </TabsContent>

        {/* ── End Strategy tab ── */}
        <TabsContent value="end">
          <Box mt="4">
            <SelectField
              label="End strategy"
              helpText="What happens when the ramp completes or a hard date is reached."
              value={endStrategyType}
              onChange={(v) =>
                form.setValue("ramp.endStrategyType", v as EndStrategyType)
              }
              options={[
                {
                  value: "none",
                  label: "None — no automatic end action",
                },
                {
                  value: "soft",
                  label: "Soft date — remind me to end the experiment",
                },
                {
                  value: "soft-edf",
                  label:
                    "Soft with EDF — auto-rollout if EDF gives a clear winner, else prompt",
                },
                {
                  value: "hard-planned",
                  label:
                    "Hard planned release — forcibly ship a specific variation on date",
                },
              ]}
            />

            {(endStrategyType === "soft" ||
              endStrategyType === "soft-edf" ||
              endStrategyType === "hard-planned") && (
              <Box mt="3">
                <Text as="label" color="text-high" mb="2">
                  End Date{" "}
                  <Text as="span" color="text-mid">
                    ({formatTimeZone(new Date(), "z")})
                  </Text>
                </Text>
                <DatePicker
                  containerClassName=""
                  clearButton
                  label=""
                  date={form.watch("ramp.endDate")}
                  disableBefore={now}
                  setDate={(v) => {
                    form.setValue("ramp.endDate", v ? v.toISOString() : "");
                  }}
                />
              </Box>
            )}

            {endStrategyType === "hard-planned" && (
              <Box mt="3">
                <SelectField
                  label="Planned release variation"
                  helpText="This variation will be forcibly released on the end date."
                  value={form.watch("ramp.plannedVariationId")}
                  onChange={(v) => form.setValue("ramp.plannedVariationId", v)}
                  options={[
                    { value: "", label: "Select variation…" },
                    ...experiment.variations.map((v, i) => ({
                      value: v.id,
                      label: `${i === 0 ? "Control" : `Variation ${i}`}: ${v.name}`,
                    })),
                  ]}
                />
              </Box>
            )}
          </Box>
        </TabsContent>

        {/* ── Monitoring Behavior tab ── */}
        <TabsContent value="monitoring">
          <Box mt="4">
            <Callout status="info" mb="4">
              These settings control how the ramp engine responds to statistical
              signals and experiment health issues. Thresholds (e.g. super-stat-sig
              guardrail failure) are configured in your Decision Criteria.
            </Callout>

            <Grid columns="2" gap="4">
              <SelectField
                label="On rollback-now signal"
                helpText="EDF emits rollback-now when a rule fires at super-stat-sig threshold."
                value={form.watch("ramp.onRollbackNow")}
                onChange={(v) =>
                  form.setValue(
                    "ramp.onRollbackNow",
                    v as "hold" | "rollback",
                  )
                }
                options={[
                  {
                    value: "hold",
                    label: "Hold step & prompt user (recommended)",
                  },
                  { value: "rollback", label: "Auto-rollback immediately" },
                ]}
              />

              <SelectField
                label="On ship-now signal"
                helpText="EDF emits ship-now when a clear winner exists at super-stat-sig."
                value={form.watch("ramp.onShipNow")}
                onChange={(v) =>
                  form.setValue(
                    "ramp.onShipNow",
                    v as "advance-and-prompt" | "ship",
                  )
                }
                options={[
                  {
                    value: "advance-and-prompt",
                    label: "Advance ramp & surface CTA (recommended)",
                  },
                  {
                    value: "ship",
                    label: "Auto-execute end strategy immediately",
                  },
                ]}
              />

              <SelectField
                label="On review-now signal"
                helpText='EDF emits review-now when a "review" action fires at super-stat-sig.'
                value={form.watch("ramp.onReviewNow")}
                onChange={(v) =>
                  form.setValue("ramp.onReviewNow", v as "hold" | "rollback")
                }
                options={[
                  {
                    value: "hold",
                    label: "Hold step & prompt user (recommended)",
                  },
                  {
                    value: "rollback",
                    label: "Auto-rollback on review signal",
                  },
                ]}
              />

              <SelectField
                label="SRM action"
                helpText="What to do when a Sample Ratio Mismatch is detected."
                value={form.watch("ramp.srmAction")}
                onChange={(v) =>
                  form.setValue(
                    "ramp.srmAction",
                    v as "hold" | "rollback" | "warn",
                  )
                }
                options={[
                  { value: "hold", label: "Hold step (recommended)" },
                  { value: "rollback", label: "Auto-rollback" },
                  { value: "warn", label: "Warn only, keep advancing" },
                ]}
              />

              <SelectField
                label="Multiple exposures action"
                helpText="What to do when users are bucketed into multiple variants."
                value={form.watch("ramp.multipleExposureAction")}
                onChange={(v) =>
                  form.setValue(
                    "ramp.multipleExposureAction",
                    v as "hold" | "rollback" | "warn",
                  )
                }
                options={[
                  { value: "hold", label: "Hold step (recommended)" },
                  { value: "rollback", label: "Auto-rollback" },
                  { value: "warn", label: "Warn only, keep advancing" },
                ]}
              />

              <SelectField
                label="No traffic action"
                helpText="What to do when no users have been exposed after the grace period."
                value={form.watch("ramp.noTrafficAction")}
                onChange={(v) =>
                  form.setValue(
                    "ramp.noTrafficAction",
                    v as "hold" | "rollback" | "warn",
                  )
                }
                options={[
                  { value: "hold", label: "Hold step (recommended)" },
                  { value: "rollback", label: "Auto-rollback" },
                  { value: "warn", label: "Warn only, keep advancing" },
                ]}
              />
            </Grid>

            <Box mt="4">
              <Field
                label="No-traffic grace period (hours)"
                type="number"
                min={0}
                max={168}
                helpText="How long to wait for traffic before applying the no-traffic action. Default: 24 hours."
                {...form.register("ramp.noTrafficGracePeriodHours", {
                  valueAsNumber: true,
                })}
              />
            </Box>
          </Box>
        </TabsContent>
      </Tabs>
    </ModalStandard>
  );
}
