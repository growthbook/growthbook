// Standalone schedule editor for ramps with multiple (or no) implementation targets.
// Edits name, step triggers, and per-target coverage. Saves via PUT /ramp-schedule/:id.

import { useState } from "react";
import { Box, Flex, IconButton, Separator } from "@radix-ui/themes";
import { PiPlusBold, PiXBold } from "react-icons/pi";
import {
  type RampScheduleInterface,
  type RampStep,
  type FeatureRulePatch,
} from "shared/validators";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import styles from "@/components/Features/VariationsInput.module.scss";

// ─── Local state types ───────────────────────────────────────────────────────

type EditTrigger =
  | { type: "interval"; seconds: number }
  | { type: "approval" }
  | { type: "scheduled"; at: string }; // ISO string for input compatibility

type EditAction = {
  targetId: string;
  patch: FeatureRulePatch;
};

type EditStep = {
  _key: string; // stable React key
  trigger: EditTrigger;
  actions: EditAction[];
  notifyOnEntry: boolean;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

let _keyCounter = 0;
function nextKey() {
  return `step-${++_keyCounter}`;
}

function secondsToDisplay(s: number): {
  value: number;
  unit: "minutes" | "hours";
} {
  if (s % 3600 === 0) return { value: s / 3600, unit: "hours" };
  return { value: Math.round(s / 60), unit: "minutes" };
}

function toSeconds(value: number, unit: "minutes" | "hours"): number {
  return value * (unit === "hours" ? 3600 : 60);
}

function targetLabel(
  rs: RampScheduleInterface,
  targetId: string,
  idx: number,
): string {
  const t = rs.targets.find((t) => t.id === targetId);
  if (!t) return `Target ${idx + 1}`;
  const parts: string[] = [];
  if (t.environment) parts.push(t.environment);
  if (t.ruleId) parts.push(t.ruleId);
  return parts.length ? parts.join(" / ") : `Target ${idx + 1}`;
}

function schemaToEditStep(step: RampStep): EditStep {
  const trigger = step.trigger;
  let editTrigger: EditTrigger;
  if (trigger.type === "interval") {
    editTrigger = { type: "interval", seconds: trigger.seconds };
  } else if (trigger.type === "scheduled") {
    editTrigger = {
      type: "scheduled",
      at:
        trigger.at instanceof Date
          ? trigger.at.toISOString().slice(0, 16)
          : String(trigger.at).slice(0, 16),
    };
  } else {
    editTrigger = { type: "approval" };
  }
  return {
    _key: nextKey(),
    trigger: editTrigger,
    actions: step.actions.map((a) => ({
      targetId: a.targetId,
      patch: { ...a.patch },
    })),
    notifyOnEntry: step.notifyOnEntry ?? false,
  };
}

function editStepToSchema(step: EditStep): RampStep {
  const { trigger } = step;
  let schemaTrigger: RampStep["trigger"];
  if (trigger.type === "interval") {
    schemaTrigger = { type: "interval", seconds: trigger.seconds };
  } else if (trigger.type === "scheduled") {
    schemaTrigger = { type: "scheduled", at: new Date(trigger.at) };
  } else {
    schemaTrigger = { type: "approval" };
  }
  return {
    trigger: schemaTrigger,
    actions: step.actions.map((a) => ({
      targetId: a.targetId,
      patch: a.patch,
    })),
    notifyOnEntry: step.notifyOnEntry || undefined,
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TriggerEditor({
  trigger,
  onChange,
}: {
  trigger: EditTrigger;
  onChange: (t: EditTrigger) => void;
}) {
  const display =
    trigger.type === "interval" ? secondsToDisplay(trigger.seconds) : null;

  return (
    <Flex gap="2" align="center" wrap="wrap">
      <Box style={{ minWidth: 120 }}>
        <SelectField
          value={trigger.type}
          options={[
            { value: "interval", label: "Timed interval" },
            { value: "approval", label: "Approval gate" },
            { value: "scheduled", label: "Specific date" },
          ]}
          onChange={(v) => {
            if (v === "interval") onChange({ type: "interval", seconds: 600 });
            else if (v === "scheduled") onChange({ type: "scheduled", at: "" });
            else onChange({ type: "approval" });
          }}
          containerClassName="mb-0"
        />
      </Box>

      {trigger.type === "interval" && display && (
        <Flex align="center" gap="1">
          <Box
            style={{
              position: "relative",
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            <input
              type="number"
              min={1}
              value={display.value}
              onChange={(e) =>
                onChange({
                  type: "interval",
                  seconds: toSeconds(
                    Math.max(1, parseInt(e.target.value) || 1),
                    display.unit,
                  ),
                })
              }
              className={styles.coverageInput}
              style={{ width: 64 }}
            />
          </Box>
          <SelectField
            value={display.unit}
            options={[
              { value: "minutes", label: "min" },
              { value: "hours", label: "hrs" },
            ]}
            onChange={(u) =>
              onChange({
                type: "interval",
                seconds: toSeconds(display.value, u as "minutes" | "hours"),
              })
            }
            containerClassName="mb-0"
          />
        </Flex>
      )}

      {trigger.type === "scheduled" && (
        <input
          type="datetime-local"
          value={trigger.at}
          onChange={(e) => onChange({ type: "scheduled", at: e.target.value })}
          style={{ fontSize: 13, padding: "4px 6px" }}
        />
      )}

      {trigger.type === "approval" && (
        <Text size="small" color="text-low">
          Waits for manual approval
        </Text>
      )}
    </Flex>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  rs: RampScheduleInterface;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}

export default function RampScheduleEditorModal({
  rs,
  onClose,
  onSaved,
}: Props) {
  const { apiCall } = useAuth();

  const [name, setName] = useState(rs.name);
  const [steps, setSteps] = useState<EditStep[]>(() =>
    rs.steps.map(schemaToEditStep),
  );

  // ── Step mutations ──────────────────────────────────────────────────────────

  function updateTrigger(idx: number, trigger: EditTrigger) {
    setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, trigger } : s)));
  }

  function updateCoverage(stepIdx: number, targetId: string, value: number) {
    setSteps((prev) =>
      prev.map((s, i) => {
        if (i !== stepIdx) return s;
        return {
          ...s,
          actions: s.actions.map((a) =>
            a.targetId === targetId
              ? { ...a, patch: { ...a.patch, coverage: value } }
              : a,
          ),
        };
      }),
    );
  }

  function removeStep(idx: number) {
    setSteps((prev) => prev.filter((_, i) => i !== idx));
  }

  function addStep() {
    const last = steps[steps.length - 1];
    const trigger: EditTrigger =
      last?.trigger.type === "interval"
        ? { type: "interval", seconds: last.trigger.seconds }
        : { type: "interval", seconds: 600 };

    // Clone actions from the last step, bumping coverage if present
    const actions: EditAction[] = (
      last?.actions ??
      rs.targets.map((t) => ({
        targetId: t.id,
        patch: { ruleId: t.ruleId ?? "" },
      }))
    ).map((a) => {
      const prevCov = a.patch.coverage;
      return {
        ...a,
        patch: {
          ...a.patch,
          ...(prevCov !== undefined
            ? { coverage: Math.min(1, prevCov + 0.25) }
            : {}),
        },
      };
    });

    setSteps((prev) => [
      ...prev,
      { _key: nextKey(), trigger, actions, notifyOnEntry: false },
    ]);
  }

  // ── Save ────────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (!name.trim()) throw new Error("Name is required");
    await apiCall(`/ramp-schedule/${rs.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: name.trim(),
        steps: steps.map(editStepToSchema),
      }),
    });
    await onSaved();
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const multiTarget = rs.targets.length > 1;

  return (
    <Modal
      open
      close={onClose}
      header={`Edit schedule: ${rs.name}`}
      size="lg"
      submit={handleSubmit}
      cta="Save"
      trackingEventModalType="ramp-schedule-editor"
    >
      <Field
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />

      {/* Steps */}
      <Box mt="3">
        {steps.length === 0 && (
          <Text size="small" color="text-low" as="p" mb="3">
            No intermediate steps — add one below.
          </Text>
        )}

        {steps.map((step, idx) => (
          <Box
            key={step._key}
            mb="3"
            style={{
              border: "1px solid var(--gray-a5)",
              borderRadius: "var(--radius-2)",
              padding: "12px 14px",
            }}
          >
            <Flex justify="between" align="center" mb="2">
              <Text weight="medium" color="text-low">
                Step {idx + 1}
              </Text>
              <IconButton
                variant="ghost"
                color="gray"
                size="1"
                radius="full"
                onClick={() => removeStep(idx)}
              >
                <PiXBold size={12} />
              </IconButton>
            </Flex>

            <TriggerEditor
              trigger={step.trigger}
              onChange={(t) => updateTrigger(idx, t)}
            />

            {/* Per-target coverage inputs */}
            {step.actions.some((a) => a.patch.coverage !== undefined) && (
              <>
                <Separator size="4" my="2" />
                <Text size="small" color="text-low" mb="1" as="p">
                  Coverage
                </Text>
                <Flex gap="3" wrap="wrap">
                  {step.actions
                    .filter((a) => a.patch.coverage !== undefined)
                    .map((action, aIdx) => (
                      <Flex key={action.targetId} align="center" gap="1">
                        {multiTarget && (
                          <Text size="small" color="text-low">
                            {targetLabel(rs, action.targetId, aIdx)}:
                          </Text>
                        )}
                        <Box
                          style={{
                            position: "relative",
                            display: "inline-flex",
                            alignItems: "center",
                          }}
                        >
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={Math.round(
                              (action.patch.coverage ?? 0) * 100,
                            )}
                            onChange={(e) =>
                              updateCoverage(
                                idx,
                                action.targetId,
                                Math.min(
                                  1,
                                  Math.max(
                                    0,
                                    (parseInt(e.target.value) || 0) / 100,
                                  ),
                                ),
                              )
                            }
                            className={styles.coverageInput}
                            style={{ width: 64 }}
                          />
                          <span className={styles.coverageInputSuffix}>%</span>
                        </Box>
                      </Flex>
                    ))}
                </Flex>
              </>
            )}
          </Box>
        ))}

        <Link onClick={addStep} style={{ fontSize: "var(--font-size-1)" }}>
          <PiPlusBold size={10} style={{ marginRight: 3 }} />
          Add step
        </Link>
      </Box>
    </Modal>
  );
}
