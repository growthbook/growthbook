import { useCallback, useState } from "react";
import { useForm } from "react-hook-form";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { DEFAULT_DECISION_FRAMEWORK_ENABLED } from "shared/constants";
import { PiInfo } from "react-icons/pi";
import { Box, Flex } from "@radix-ui/themes";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import DatePicker from "@/components/DatePicker";
import Field from "@/components/Forms/Field";
import { useAuth } from "@/services/auth";
import Text from "@/ui/Text";
import Helpertext from "@/ui/HelperText";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import SelectField from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import useOrgSettings from "@/hooks/useOrgSettings";

type ShippingMode = "notify" | "auto-ship";
type ShippingFallback = "notify" | "force-ship";
type EndMode = "manual" | "on-date" | "after-days";

// Shared width for the "Start"/"End" label column.
const LABEL_COL_WIDTH = 60;

export default function EditScheduleModal({
  experiment,
  mutate,
  close,
}: {
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  close: () => void;
}) {
  const { hasCommercialFeature } = useUser();
  const { getExperimentMetricById } = useDefinitions();
  const { decisionFrameworkEnabled } = useOrgSettings();
  // Auto-ship needs both the paid feature AND the org's decision-framework
  // toggle enabled — matches the back-end apply-time gate.
  const hasDecisionFrameworkFeature =
    hasCommercialFeature("decision-framework");
  const autoShipAvailable =
    hasDecisionFrameworkFeature &&
    (decisionFrameworkEnabled ?? DEFAULT_DECISION_FRAMEWORK_ENABLED);
  const autoShipDisabledReason = !hasDecisionFrameworkFeature
    ? "Auto-ship requires the Decision Framework (available on Pro and Enterprise plans)."
    : "Enable the Decision Framework in your organization settings to use auto-ship.";

  const form = useForm({
    defaultValues: {
      startAt: experiment.statusUpdateSchedule?.startAt ?? "",
      stopAt: experiment.statusUpdateSchedule?.stopAt ?? "",
      mode: (experiment.shippingCriteria?.mode ?? "notify") as ShippingMode,
      tiebreakerMetricId: experiment.shippingCriteria?.tiebreakerMetricId ?? "",
      fallback: (experiment.shippingCriteria?.fallback ??
        "notify") as ShippingFallback,
      fallbackVariationId:
        experiment.shippingCriteria?.fallbackVariationId ?? "",
    },
  });

  const { apiCall } = useAuth();

  const now = new Date();
  const hasSchedule = !!(
    experiment.statusUpdateSchedule?.startAt ||
    experiment.statusUpdateSchedule?.stopAt
  );
  const isApproved = !!experiment.nextScheduledStatusUpdate;
  const startAt = form.watch("startAt");
  const stopAt = form.watch("stopAt");
  const mode = form.watch("mode");
  const fallback = form.watch("fallback");

  const scheduleIsInThePast =
    experiment.statusUpdateSchedule?.startAt &&
    new Date(experiment.statusUpdateSchedule.startAt) < now;
  const stopBeforeStart =
    startAt && stopAt && new Date(stopAt) <= new Date(startAt);

  const metricOptions = (experiment.goalMetrics ?? []).map((id) => ({
    value: id,
    label: getExperimentMetricById(id)?.name ?? id,
  }));
  const variationOptions = experiment.variations.map((v, i) => ({
    value: v.id,
    label: v.name || `Variation ${i}`,
  }));

  // End-date UI mode. "after-days" is a UI affordance that still writes a
  // concrete ISO `stopAt` (start + N), so the back-end stays date-based.
  const [endMode, setEndMode] = useState<EndMode>(
    stopAt ? "on-date" : "manual",
  );
  const [endAfterValue, setEndAfterValue] = useState<number>(30);
  const [endAfterUnit, setEndAfterUnit] = useState<"days" | "hours">("days");

  const computeEndAfter = useCallback(
    (value: number, unit: "days" | "hours"): string => {
      const base = startAt ? new Date(startAt) : new Date();
      const ms = value * (unit === "days" ? 86400 : 3600) * 1000;
      const d = new Date(base.getTime() + ms);
      d.setSeconds(0, 0);
      return d.toISOString();
    },
    [startAt],
  );

  return (
    <ModalStandard
      trackingEventModalType="edit-schedule-modal"
      trackingEventModalSource="eid"
      open={true}
      close={close}
      header={hasSchedule ? "Edit Schedule" : "Add Schedule"}
      subheader="Schedule when this experiment starts and ends, and choose what happens automatically at the end date."
      cta={hasSchedule ? "Update" : "Done"}
      ctaColor="violet"
      ctaEnabled={!stopBeforeStart}
      size="md"
      maxWidth="650px"
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
      submit={form.handleSubmit(async (data) => {
        const schedule =
          data.startAt || data.stopAt
            ? {
                startAt: data.startAt || undefined,
                stopAt: data.stopAt || undefined,
              }
            : null;
        const shippingCriteria = {
          mode: data.mode,
          tiebreakerMetricId:
            data.mode === "auto-ship" && data.tiebreakerMetricId
              ? data.tiebreakerMetricId
              : undefined,
          fallback: data.mode === "auto-ship" ? data.fallback : "notify",
          fallbackVariationId:
            data.mode === "auto-ship" && data.fallback === "force-ship"
              ? data.fallbackVariationId
              : undefined,
        };
        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify({
            statusUpdateSchedule: schedule,
            shippingCriteria,
          }),
        });
        mutate();
      })}
    >
      <Flex direction="column" gap="4">
        <Flex direction="column" gap="1">
          {/* Start row */}
          <Flex align="center" gap="3" py="1" style={{ minHeight: 42 }}>
            <Box style={{ width: LABEL_COL_WIDTH }}>
              <Text as="label" weight="medium" mb="0">
                Start
              </Text>
            </Box>
            <SelectField
              label=""
              value={startAt ? "on-date" : "immediately"}
              sort={false}
              options={[
                { value: "immediately", label: "Immediately" },
                { value: "on-date", label: "On date" },
              ]}
              onChange={(v) => {
                if (v === "immediately") {
                  form.setValue("startAt", "");
                } else {
                  const d = new Date();
                  d.setSeconds(0, 0);
                  form.setValue("startAt", d.toISOString());
                }
              }}
              containerStyle={{ minHeight: 38, width: 150 }}
            />
            {startAt && (
              <DatePicker
                label=""
                date={startAt || undefined}
                setDate={(d) =>
                  form.setValue("startAt", d ? d.toISOString() : "")
                }
                precision="datetime"
                scheduleEndDate={stopAt || undefined}
                disableBefore={now}
              />
            )}
          </Flex>

          {/* End row */}
          <Flex align="center" gap="3" py="1" style={{ minHeight: 42 }}>
            <Box style={{ width: LABEL_COL_WIDTH }}>
              <Text as="label" weight="medium" mb="0">
                End
              </Text>
            </Box>
            <SelectField
              label=""
              value={endMode}
              sort={false}
              options={[
                { value: "manual", label: "When stopped" },
                { value: "after-days", label: "After" },
                { value: "on-date", label: "On date" },
              ]}
              onChange={(v) => {
                const next = v as EndMode;
                setEndMode(next);
                if (next === "manual") {
                  form.setValue("stopAt", "");
                } else if (next === "on-date") {
                  const d = new Date();
                  d.setDate(d.getDate() + 30);
                  d.setSeconds(0, 0);
                  form.setValue("stopAt", d.toISOString());
                } else {
                  form.setValue(
                    "stopAt",
                    computeEndAfter(endAfterValue, endAfterUnit),
                  );
                }
              }}
              containerStyle={{ minHeight: 38, width: 150 }}
            />
            {endMode === "on-date" && (
              <DatePicker
                label=""
                date={stopAt || undefined}
                setDate={(d) =>
                  form.setValue("stopAt", d ? d.toISOString() : "")
                }
                precision="datetime"
                scheduleStartDate={startAt || undefined}
                disableBefore={startAt ? new Date(startAt) : now}
              />
            )}
            {endMode === "after-days" && (
              <Flex align="center" gap="3">
                <Field
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={endAfterValue}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => {
                    const n = Math.max(
                      0.01,
                      parseFloat(e.target.value) || 0.01,
                    );
                    setEndAfterValue(n);
                    form.setValue("stopAt", computeEndAfter(n, endAfterUnit));
                  }}
                  style={{ width: 78, minHeight: 38 }}
                />
                <SelectField
                  label=""
                  value={endAfterUnit}
                  sort={false}
                  options={[
                    { value: "hours", label: "hours" },
                    { value: "days", label: "days" },
                  ]}
                  onChange={(v) => {
                    const u = v as "days" | "hours";
                    setEndAfterUnit(u);
                    form.setValue("stopAt", computeEndAfter(endAfterValue, u));
                  }}
                  containerStyle={{ width: 110 }}
                />
              </Flex>
            )}
          </Flex>
        </Flex>

        {scheduleIsInThePast && (
          <Helpertext status="warning">Scheduled start has passed</Helpertext>
        )}
        {stopBeforeStart && (
          <Helpertext status="warning">
            End date must be after the start date
          </Helpertext>
        )}

        <Box>
          <Text as="label" color="text-high" mb="1">
            When the experiment ends
          </Text>
          <SelectField
            label=""
            value={mode}
            sort={false}
            options={[
              { value: "notify", label: "Notify only (no automatic change)" },
              { value: "auto-ship", label: "Auto-ship the winning variation" },
            ]}
            isOptionDisabled={(o) =>
              "value" in o && o.value === "auto-ship" && !autoShipAvailable
            }
            // Disabled options: solid muted color instead of the default 0.5
            // opacity, which lets the content behind the menu bleed through.
            containerStyles={{
              option: (base) => ({ ...base, opacity: 1 }),
            }}
            formatOptionLabel={(o) => {
              if (o.value !== "auto-ship" || autoShipAvailable) {
                return <>{o.label}</>;
              }
              return (
                <Flex align="center" justify="between" gap="2">
                  <Text color="text-low">{o.label}</Text>
                  <Tooltip body={autoShipDisabledReason} tipPosition="top">
                    <PiInfo style={{ verticalAlign: "middle" }} />
                  </Tooltip>
                </Flex>
              );
            }}
            onChange={(v) => form.setValue("mode", v as ShippingMode)}
          />
        </Box>

        {mode === "auto-ship" && (
          <Flex direction="column" gap="3">
            <Callout status="info">
              Auto-ship rolls out the winning variation to its linked features
              at the end date
            </Callout>

            <Box>
              <Text as="label" color="text-high" mb="1">
                Tiebreaker metric{" "}
                <Text as="span" color="text-mid">
                  (optional)
                </Text>
              </Text>
              <Text as="div" color="text-mid" mb="1" size="small">
                If two variations both qualify, ship the one with the higher
                lift on this goal metric.
              </Text>
              <SelectField
                label=""
                value={form.watch("tiebreakerMetricId")}
                options={metricOptions}
                initialOption="None"
                onChange={(v) => form.setValue("tiebreakerMetricId", v)}
              />
            </Box>

            <Box>
              <Text as="label" color="text-high" mb="1">
                If there&apos;s no clear winner
              </Text>
              <SelectField
                label=""
                value={fallback}
                options={[
                  { value: "notify", label: "Notify only — leave for review" },
                  {
                    value: "force-ship",
                    label: "Force-ship a specific variation",
                  },
                ]}
                onChange={(v) =>
                  form.setValue("fallback", v as ShippingFallback)
                }
              />
            </Box>

            {fallback === "force-ship" && (
              <Box>
                <Text as="label" color="text-high" mb="1">
                  Variation to force-ship
                </Text>
                <SelectField
                  label=""
                  value={form.watch("fallbackVariationId")}
                  options={variationOptions}
                  onChange={(v) => form.setValue("fallbackVariationId", v)}
                />
              </Box>
            )}
          </Flex>
        )}
      </Flex>
    </ModalStandard>
  );
}
