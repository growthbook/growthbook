import { useState } from "react";
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
import SelectField from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import VariationLabel from "@/ui/VariationLabel";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import useOrgSettings from "@/hooks/useOrgSettings";

type ShippingMode = "notify" | "auto-ship" | "force-ship" | "stop";
type ShippingFallback = "notify" | "force-ship";
type EndMode = "manual" | "on-date" | "after";

// Shared width for the "Start"/"End" label column.
const LABEL_COL_WIDTH = 60;

// Default end offset, shared by the "After N days" relative preset and the
// "On date" picker (which prepopulates now + this many days) so they match.
const DEFAULT_END_AFTER_DAYS = 30;

// Auto-ship's no-clear-winner fallback defaults to shipping a variation so it's
// a hard cutoff by default. Used for both the form default and the save default
// (irrelevant fields are normalized to this on save), so switching into
// auto-ship later starts from the intended default rather than a stale value.
const DEFAULT_SHIPPING_FALLBACK: ShippingFallback = "force-ship";

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
    ? "Shipping the winning variation requires the Decision Framework (available on Pro and Enterprise plans)."
    : "Enable the Decision Framework in your organization settings to ship the winning variation.";

  const form = useForm({
    defaultValues: {
      startAt: experiment.statusUpdateSchedule?.startAt ?? "",
      stopAt: experiment.statusUpdateSchedule?.stopAt ?? "",
      mode: (experiment.shippingCriteria?.mode ?? "notify") as ShippingMode,
      tiebreakerMetricId: experiment.shippingCriteria?.tiebreakerMetricId ?? "",
      // Default the no-clear-winner fallback to shipping a variation (control)
      // so auto-ship is a hard cutoff by default — it always ends at the date.
      fallback: (experiment.shippingCriteria?.fallback ??
        DEFAULT_SHIPPING_FALLBACK) as ShippingFallback,
      // Default the fallback target to control (the first variation) so the
      // picker is never blank.
      fallbackVariationId:
        experiment.shippingCriteria?.fallbackVariationId ??
        experiment.variations[0]?.id ??
        "",
    },
  });

  const { apiCall } = useAuth();

  const now = new Date();
  const initialStopAfter = experiment.statusUpdateSchedule?.stopAfter ?? null;
  const hasSchedule = !!(
    experiment.statusUpdateSchedule?.startAt ||
    experiment.statusUpdateSchedule?.stopAt ||
    initialStopAfter
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
  // A tiebreaker only matters when 2+ variations can qualify as winners (i.e.
  // there's more than one non-control variation to break a tie between). With a
  // single treatment there's never a tie, so hide the tiebreaker entirely.
  const showTiebreaker = experiment.variations.length > 2;
  const renderVariationOption = (variationId: string) => {
    const index = experiment.variations.findIndex((v) => v.id === variationId);
    if (index < 0) return null;
    return (
      <VariationLabel
        number={index}
        name={experiment.variations[index].name || `Variation ${index}`}
        disableTooltip
      />
    );
  };
  const renderTiebreakerField = (helper: string) => (
    <Box>
      <Text as="label" color="text-high" mb="1">
        Tiebreaker metric
      </Text>
      <Text as="div" color="text-mid" mb="1" size="small">
        {helper}
      </Text>
      <SelectField
        label=""
        value={form.watch("tiebreakerMetricId")}
        options={metricOptions}
        initialOption="None"
        onChange={(v) => form.setValue("tiebreakerMetricId", v)}
      />
    </Box>
  );
  const renderVariationPicker = (label: string) => (
    <Box>
      <Text as="label" color="text-high" mb="1">
        {label}
      </Text>
      <SelectField
        label=""
        value={form.watch("fallbackVariationId")}
        options={variationOptions}
        formatOptionLabel={(o) => renderVariationOption(o.value)}
        onChange={(v) => form.setValue("fallbackVariationId", v)}
      />
    </Box>
  );
  // Verdict section for force-ship / stop: the EDF + tiebreaker only tag an
  // analytical result — they don't change what the mode actually does. Set off
  // in its own box so that distinction is clear.
  const renderVerdictSection = () => (
    <Box
      mt="4"
      px="3"
      py="3"
      style={{
        backgroundColor: "var(--violet-a3)",
        borderRadius: "var(--radius-3)",
      }}
    >
      <Text as="div" size="medium" weight="semibold" color="text-high" mb="1">
        Record a result
      </Text>
      <Text as="div" color="text-mid" size="medium" mb="3">
        Even though you have selected a forced fallback or shipped variation,
        the Decision Framework will still record metadata about whether this
        experiment was won/lost/inconclusive.
      </Text>
      {showTiebreaker && (
        <>
          <Text as="div" color="text-mid" size="medium" mb="3">
            The tiebreaker metric will break ties when multiple variations
            qualify.
          </Text>
          <Text as="label" color="text-high" mb="1">
            Tiebreaker metric
          </Text>
          <SelectField
            label=""
            value={autoShipAvailable ? form.watch("tiebreakerMetricId") : ""}
            options={metricOptions}
            initialOption="None"
            disabled={!autoShipAvailable}
            onChange={(v) => form.setValue("tiebreakerMetricId", v)}
          />
          {!autoShipAvailable && (
            <Text as="div" color="text-mid" size="small" mt="1">
              Enable the Decision Framework in your organization settings to
              record a verdict.
            </Text>
          )}
        </>
      )}
    </Box>
  );

  // "after" stores a relative offset (stopAfter) that the back-end resolves to a
  // concrete stopAt when the experiment actually starts.
  const [endMode, setEndMode] = useState<EndMode>(
    stopAt ? "on-date" : initialStopAfter ? "after" : "manual",
  );
  const [endAfterValue, setEndAfterValue] = useState<number>(
    initialStopAfter?.value ?? DEFAULT_END_AFTER_DAYS,
  );
  const [endAfterUnit, setEndAfterUnit] = useState<"days" | "hours">(
    initialStopAfter?.unit ?? "days",
  );
  // Shipping automation is tied to a scheduled end — it never runs on a manual
  // stop — so the "when the experiment ends" controls only apply with an end date.
  const hasEndDate = endMode !== "manual";
  // "On date" requires an actual date. Block save (rather than silently
  // discarding the shipping config on submit) if the picker was left empty.
  const endDateMissing = endMode === "on-date" && !stopAt;

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
      ctaEnabled={!stopBeforeStart && !endDateMissing}
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
      submit={form.handleSubmit(async (data) => {
        const stopAt =
          endMode === "on-date" ? data.stopAt || undefined : undefined;
        const stopAfter =
          endMode === "after"
            ? { value: endAfterValue, unit: endAfterUnit }
            : undefined;
        const schedule =
          data.startAt || stopAt || stopAfter
            ? {
                startAt: data.startAt || undefined,
                stopAt,
                stopAfter,
              }
            : null;
        // Shipping automation only ever fires at a scheduled end. Without an
        // end date, force "notify" so we never persist automation that a
        // manual stop wouldn't honor.
        // Normalize on save: only persist fields relevant to the chosen mode;
        // reset the rest to defaults so a stale value can't resurface when the
        // user later switches modes.
        const hasEndDate = !!(stopAt || stopAfter);
        const shippingCriteria = hasEndDate
          ? {
              mode: data.mode,
              // Tiebreaker feeds the EDF verdict for every non-notify mode, but
              // only when the framework is available (the field is disabled and
              // shows "None" otherwise — don't silently re-persist a stale id).
              tiebreakerMetricId:
                autoShipAvailable &&
                data.mode !== "notify" &&
                data.tiebreakerMetricId
                  ? data.tiebreakerMetricId
                  : undefined,
              // Fallback only applies to auto-ship; otherwise reset to default.
              fallback:
                data.mode === "auto-ship"
                  ? data.fallback
                  : DEFAULT_SHIPPING_FALLBACK,
              // A fallback variation is only needed when force-shipping.
              fallbackVariationId:
                data.mode === "force-ship" ||
                (data.mode === "auto-ship" && data.fallback === "force-ship")
                  ? data.fallbackVariationId
                  : undefined,
            }
          : { mode: "notify" as const, fallback: DEFAULT_SHIPPING_FALLBACK };
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
                { value: "after", label: "After" },
                { value: "on-date", label: "On date" },
              ]}
              onChange={(v) => {
                const next = v as EndMode;
                setEndMode(next);
                // "after" carries its offset in local state; only "on-date"
                // uses a concrete stopAt.
                if (next === "on-date") {
                  const d = new Date();
                  d.setDate(d.getDate() + DEFAULT_END_AFTER_DAYS);
                  d.setSeconds(0, 0);
                  form.setValue("stopAt", d.toISOString());
                } else {
                  form.setValue("stopAt", "");
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
            {endMode === "after" && (
              <Flex align="center" gap="3">
                <Field
                  type="number"
                  min="1"
                  step="1"
                  value={endAfterValue}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => {
                    // Whole units only — the back-end resolver floors fractional
                    // offsets (date-fns addDays/addHours).
                    const n = Math.max(
                      1,
                      Math.floor(parseFloat(e.target.value) || 1),
                    );
                    setEndAfterValue(n);
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
                  onChange={(v) => setEndAfterUnit(v as "days" | "hours")}
                  containerStyle={{ width: 110 }}
                />
                <Text color="text-mid" size="small">
                  from start
                </Text>
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
        {endDateMissing && (
          <Helpertext status="warning">Select an end date</Helpertext>
        )}

        {hasEndDate && (
          <>
            <Box>
              <Text as="label" color="text-high" mb="1">
                When the experiment ends
              </Text>
              <SelectField
                label=""
                value={mode}
                sort={false}
                options={[
                  { value: "notify", label: "Notify only — keep running" },
                  {
                    value: "auto-ship",
                    label: "Ship the winning variation",
                  },
                  {
                    value: "force-ship",
                    label: "Ship a specific variation",
                  },
                  { value: "stop", label: "Stop the experiment (no rollout)" },
                ]}
                // Only auto-ship needs the decision framework to function; the
                // others are basic. Disabled options use solid muted color
                // instead of the default 0.5 opacity that bleeds through.
                isOptionDisabled={(o) =>
                  "value" in o && o.value === "auto-ship" && !autoShipAvailable
                }
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

            {mode === "notify" && (
              <Helpertext status="info" mb="3">
                The experiment keeps running past the end date — you&apos;ll be
                notified
                {autoShipAvailable ? ", with a recommendation to review" : ""}.
              </Helpertext>
            )}

            {mode === "auto-ship" && (
              <Flex direction="column" gap="3">
                <Helpertext status="info" mb="3">
                  Stops the experiment and rolls out the winning variation to
                  linked features
                </Helpertext>

                {showTiebreaker &&
                  renderTiebreakerField(
                    "If two variations both qualify, ship the one with the higher lift on this goal metric.",
                  )}

                <Box>
                  <Text as="label" color="text-high" mb="1">
                    If there&apos;s no clear winner
                  </Text>
                  <SelectField
                    label=""
                    value={fallback}
                    options={[
                      { value: "notify", label: "Keep running — notify me" },
                      {
                        value: "force-ship",
                        label: "Ship a specific variation",
                      },
                    ]}
                    onChange={(v) =>
                      form.setValue("fallback", v as ShippingFallback)
                    }
                  />
                </Box>

                {fallback === "force-ship" &&
                  renderVariationPicker("Variation to ship")}
              </Flex>
            )}

            {mode === "force-ship" && (
              <Flex direction="column" gap="3">
                <Helpertext status="info" mb="3">
                  Stops the experiment and rolls out this variation to linked
                  features, regardless of results
                </Helpertext>
                {renderVariationPicker("Variation to ship")}
                {hasDecisionFrameworkFeature && renderVerdictSection()}
              </Flex>
            )}

            {mode === "stop" && (
              <Flex direction="column" gap="3">
                <Helpertext status="info" mb="3">
                  Stops the experiment and reverts to any default feature flag
                  values, regardless of results
                </Helpertext>
                {hasDecisionFrameworkFeature && renderVerdictSection()}
              </Flex>
            )}
          </>
        )}
      </Flex>
    </ModalStandard>
  );
}
