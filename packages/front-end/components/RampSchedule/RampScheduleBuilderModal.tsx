import { useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiPlusBold, PiTrashBold, PiXBold } from "react-icons/pi";
import type { FeatureInterface } from "shared/types/feature";
import { Environment } from "shared/types/organization";
import Text from "@/ui/Text";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import Button from "@/ui/Button";

// ---------------------------------------------------------------------------
// Types — mirrors RampScheduleSection UIStep shape
// ---------------------------------------------------------------------------

type IntervalUnit = "minutes" | "hours";
type PatchField = "coverage" | "condition" | "force";

type UIStepPatch = {
  coverage?: number;
  condition?: string;
  force?: string;
};

type UIStep = {
  patch: UIStepPatch;
  triggerType: "interval" | "approval";
  intervalValue: number;
  intervalUnit: IntervalUnit;
};

const UNIT_MULT: Record<IntervalUnit, number> = { minutes: 60, hours: 3600 };

function patchFieldLabel(
  field: PatchField,
  valueType?: FeatureInterface["valueType"],
): string {
  switch (field) {
    case "coverage":
      return "Coverage (%)";
    case "condition":
      return "Condition (JSON)";
    case "force":
      return `Force value${valueType ? ` (${valueType})` : ""}`;
  }
}

const ALL_PATCH_FIELDS: PatchField[] = ["coverage", "condition", "force"];
function unsetFields(patch: UIStepPatch): PatchField[] {
  return ALL_PATCH_FIELDS.filter((f) => patch[f] === undefined);
}

function buildPatch(
  patch: UIStepPatch,
  ruleId: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ruleId };
  if (patch.coverage !== undefined) out.coverage = patch.coverage / 100;
  if (patch.condition !== undefined) out.condition = patch.condition;
  if (patch.force !== undefined) {
    try {
      out.force = JSON.parse(patch.force);
    } catch {
      out.force = patch.force;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

type Preset = { label: string; steps: UIStep[] };

const PRESETS: Preset[] = [
  {
    label: "Linear / 30m",
    steps: [20, 40, 60, 80, 100].map((coverage) => ({
      patch: { coverage },
      triggerType: "interval",
      intervalValue: 6,
      intervalUnit: "minutes",
    })),
  },
  {
    label: "Linear / 1h",
    steps: [20, 40, 60, 80, 100].map((coverage) => ({
      patch: { coverage },
      triggerType: "interval",
      intervalValue: 12,
      intervalUnit: "minutes",
    })),
  },
  {
    label: "Fast (3 steps)",
    steps: [25, 75, 100].map((coverage) => ({
      patch: { coverage },
      triggerType: "interval",
      intervalValue: 5,
      intervalUnit: "minutes",
    })),
  },
  {
    label: "With approvals",
    steps: [25, 75, 100].map((coverage) => ({
      patch: { coverage },
      triggerType: "approval" as const,
      intervalValue: 10,
      intervalUnit: "minutes" as IntervalUnit,
    })),
  },
];

const DEFAULT_STEPS: UIStep[] = [
  {
    patch: { coverage: 50 },
    triggerType: "interval",
    intervalValue: 10,
    intervalUnit: "minutes",
  },
  {
    patch: { coverage: 100 },
    triggerType: "interval",
    intervalValue: 10,
    intervalUnit: "minutes",
  },
];

// ---------------------------------------------------------------------------
// Shared patch editor sub-component
// ---------------------------------------------------------------------------

interface PatchEditorProps {
  patch: UIStepPatch;
  onUpdateField: (field: PatchField, value: unknown) => void;
  onRemoveField: (field: PatchField) => void;
  onAddField: (field: PatchField) => void;
  feature: FeatureInterface;
  fieldInputStyle: React.CSSProperties;
}

function PatchEditor({
  patch,
  onUpdateField,
  onRemoveField,
  onAddField,
  feature,
  fieldInputStyle,
}: PatchEditorProps) {
  const available = unsetFields(patch);
  return (
    <>
      {patch.coverage !== undefined && (
        <Flex gap="2" align="center" mb="2">
          <span style={{ minWidth: 110 }}>
            <Text>Coverage</Text>
          </span>
          <Flex align="center" gap="1" flexGrow="1">
            <input
              type="number"
              min={0}
              max={100}
              value={patch.coverage}
              onChange={(e) =>
                onUpdateField(
                  "coverage",
                  Math.min(100, Math.max(0, parseInt(e.target.value) || 0)),
                )
              }
              style={{ ...fieldInputStyle, width: 60 }}
            />
            <Text color="text-low">%</Text>
          </Flex>
          <IconButton
            variant="ghost"
            color="gray"
            size="1"
            onClick={() => onRemoveField("coverage")}
          >
            <PiXBold />
          </IconButton>
        </Flex>
      )}
      {patch.condition !== undefined && (
        <Flex gap="2" align="start" mb="2">
          <span style={{ minWidth: 110, paddingTop: 4 }}>
            <Text>Condition</Text>
          </span>
          <Box flexGrow="1">
            <textarea
              value={patch.condition}
              onChange={(e) => onUpdateField("condition", e.target.value)}
              placeholder='{"country": "US"}'
              rows={2}
              style={{
                ...fieldInputStyle,
                width: "100%",
                resize: "vertical",
                fontFamily: "monospace",
              }}
            />
          </Box>
          <IconButton
            variant="ghost"
            color="gray"
            size="1"
            onClick={() => onRemoveField("condition")}
            style={{ marginTop: 4 }}
          >
            <PiXBold />
          </IconButton>
        </Flex>
      )}
      {patch.force !== undefined && (
        <Flex gap="2" align="center" mb="2">
          <span style={{ minWidth: 110 }}>
            <Text>{`Force value${feature.valueType ? ` (${feature.valueType})` : ""}`}</Text>
          </span>
          <Box flexGrow="1">
            {feature.valueType === "boolean" ? (
              <SelectField
                value={patch.force}
                options={[
                  { value: "true", label: "true" },
                  { value: "false", label: "false" },
                ]}
                onChange={(v) => onUpdateField("force", v)}
                containerClassName="mb-0"
              />
            ) : feature.valueType === "json" ? (
              <textarea
                value={patch.force}
                onChange={(e) => onUpdateField("force", e.target.value)}
                placeholder='{"key": "value"}'
                rows={2}
                style={{
                  ...fieldInputStyle,
                  width: "100%",
                  resize: "vertical",
                  fontFamily: "monospace",
                }}
              />
            ) : (
              <input
                type={feature.valueType === "number" ? "number" : "text"}
                value={patch.force}
                onChange={(e) => onUpdateField("force", e.target.value)}
                style={{ ...fieldInputStyle, width: "100%" }}
              />
            )}
          </Box>
          <IconButton
            variant="ghost"
            color="gray"
            size="1"
            onClick={() => onRemoveField("force")}
          >
            <PiXBold />
          </IconButton>
        </Flex>
      )}
      {available.length > 0 && (
        <Box mt="1">
          <SelectField
            value=""
            placeholder="+ Add a field to change..."
            options={available.map((f) => ({
              value: f,
              label: patchFieldLabel(f, feature.valueType),
            }))}
            onChange={(v) => onAddField(v as PatchField)}
            containerClassName="mb-0"
          />
        </Box>
      )}
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text
      size="small"
      weight="semibold"
      color="text-low"
      as="p"
      textTransform="uppercase"
      mb="2"
    >
      {children}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  feature: FeatureInterface;
  environments: Environment[];
  initialEnvironment?: string;
  initialRuleId?: string;
  onSave: () => Promise<unknown>;
  onCancel: () => void;
}

export default function RampScheduleBuilderModal({
  feature,
  environments,
  initialEnvironment,
  initialRuleId,
  onSave,
  onCancel,
}: Props) {
  const { apiCall } = useAuth();

  const firstEnv = initialEnvironment ?? environments[0]?.id ?? "";
  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState(firstEnv);
  const [ruleId, setRuleId] = useState(initialRuleId ?? "");
  const [steps, setSteps] = useState<UIStep[]>(DEFAULT_STEPS);
  const [startTime, setStartTime] = useState("");
  const [endScheduleAt, setEndScheduleAt] = useState("");
  const [endSchedulePatch, setEndSchedulePatch] = useState<UIStepPatch>({});

  const rulesInEnv = (
    feature.environmentSettings?.[environment]?.rules ?? []
  ).filter((r) => r.type === "rollout");

  const ruleOptions = rulesInEnv.map((r) => ({
    value: r.id,
    label: r.description ? `${r.id} — ${r.description}` : r.id,
  }));

  const ruleIdForEnv = rulesInEnv.find((r) => r.id === ruleId)
    ? ruleId
    : (rulesInEnv[0]?.id ?? "");

  function handleEnvChange(v: string) {
    setEnvironment(v);
    const rules = (feature.environmentSettings?.[v]?.rules ?? []).filter(
      (r) => r.type === "rollout",
    );
    setRuleId(rules[0]?.id ?? "");
  }

  function updateStep(i: number, upd: Partial<UIStep>) {
    setSteps((prev) =>
      prev.map((s, idx) => (idx === i ? { ...s, ...upd } : s)),
    );
  }

  function updateStepPatchField(
    stepIdx: number,
    field: PatchField,
    value: unknown,
  ) {
    setSteps((prev) =>
      prev.map((s, i) =>
        i === stepIdx ? { ...s, patch: { ...s.patch, [field]: value } } : s,
      ),
    );
  }

  function removeStepPatchField(stepIdx: number, field: PatchField) {
    setSteps((prev) =>
      prev.map((s, i) => {
        if (i !== stepIdx) return s;

        const { [field]: _removed, ...rest } = s.patch;
        return { ...s, patch: rest };
      }),
    );
  }

  function addStepPatchField(stepIdx: number, field: PatchField) {
    let defaultVal: number | string = "";
    if (field === "coverage") {
      const prev = steps
        .slice(0, stepIdx)
        .reverse()
        .find((s) => s.patch.coverage !== undefined)?.patch.coverage;
      defaultVal = prev !== undefined ? Math.min(100, prev + 20) : 50;
    }
    updateStepPatchField(stepIdx, field, defaultVal);
  }

  function removeStep(i: number) {
    setSteps((prev) => prev.filter((_, idx) => idx !== i));
  }

  function addStep() {
    const last = steps[steps.length - 1];
    const lastCoverage = last?.patch.coverage;
    setSteps((prev) => [
      ...prev,
      {
        patch: {
          coverage:
            lastCoverage !== undefined ? Math.min(100, lastCoverage + 20) : 50,
        },
        triggerType: "interval",
        intervalValue: last?.intervalValue ?? 10,
        intervalUnit: last?.intervalUnit ?? "minutes",
      },
    ]);
  }

  function updateEndPatchField(field: PatchField, value: unknown) {
    setEndSchedulePatch((prev) => ({ ...prev, [field]: value }));
  }

  function removeEndPatchField(field: PatchField) {
    setEndSchedulePatch((prev) => {
      const { [field]: _removed, ...rest } = prev;
      return rest;
    });
  }

  function addEndPatchField(field: PatchField) {
    const defaultVal: number | string = field === "coverage" ? 0 : "";
    updateEndPatchField(field, defaultVal);
  }

  async function handleSubmit() {
    const effectiveRuleId = ruleIdForEnv;
    if (!name.trim()) throw new Error("Name is required");
    if (!effectiveRuleId)
      throw new Error("Please select a rollout rule to ramp");
    if (steps.length === 0 && !startTime && !endScheduleAt) {
      throw new Error("Add at least one step, or set a start or end date.");
    }

    const targetId = "t1";

    const endActions = Object.values(endSchedulePatch).some(
      (v) => v !== undefined,
    )
      ? [{ targetId, patch: buildPatch(endSchedulePatch, effectiveRuleId) }]
      : [];

    const body = {
      name: name.trim(),
      entityType: "feature" as const,
      entityId: feature.id,
      targets: [
        {
          id: targetId,
          entityType: "feature" as const,
          entityId: feature.id,
          ruleId: effectiveRuleId,
          environment,
          status: "active" as const,
        },
      ],
      steps: steps.map((s, i) => ({
        trigger:
          s.triggerType === "interval"
            ? {
                type: "interval" as const,
                seconds: s.intervalValue * UNIT_MULT[s.intervalUnit],
                cumulative: true,
              }
            : { type: "approval" as const },
        actions: [{ targetId, patch: buildPatch(s.patch, effectiveRuleId) }],
        notifyOnEntry: i === 0,
      })),
      startTime: startTime || undefined,
      endSchedule: endScheduleAt
        ? { at: endScheduleAt, actions: endActions }
        : undefined,
    };

    await apiCall("/ramp-schedule", {
      method: "POST",
      body: JSON.stringify(body),
    });
    await onSave();
  }

  const fieldInputStyle: React.CSSProperties = {
    border: "1px solid var(--gray-a7)",
    borderRadius: "var(--radius-2)",
    padding: "4px 6px",
    fontSize: "14px",
    lineHeight: "1.5",
  };

  const stepCardStyle: React.CSSProperties = {
    border: "1px solid var(--gray-a5)",
    borderRadius: "var(--radius-2)",
    padding: "10px 12px",
    marginBottom: "8px",
    background: "white",
  };

  const anchorCardStyle: React.CSSProperties = {
    border: "1px solid var(--gray-a4)",
    borderRadius: "var(--radius-2)",
    padding: "10px 12px",
    marginBottom: "4px",
    background: "var(--gray-a1)",
  };

  return (
    <Modal
      open
      close={onCancel}
      header="Create Ramp Schedule"
      size="lg"
      submit={handleSubmit}
      cta="Create"
      trackingEventModalType="ramp-schedule-builder"
    >
      <Field
        label="Name"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Gradual rollout — EU users"
      />

      <Flex gap="3" mb="4">
        <Box flexGrow="1">
          <SelectField
            label="Environment"
            value={environment}
            options={environments.map((e) => ({ value: e.id, label: e.id }))}
            onChange={handleEnvChange}
          />
        </Box>
        <Box flexGrow="1">
          <SelectField
            label="Rollout rule to ramp"
            value={ruleIdForEnv}
            options={ruleOptions}
            onChange={(v) => setRuleId(v)}
            placeholder={
              ruleOptions.length === 0
                ? "No rollout rules in this environment"
                : "Select a rule…"
            }
            disabled={ruleOptions.length === 0}
          />
        </Box>
      </Flex>

      {/* Presets */}
      <Box mb="4">
        <Text weight="medium" mb="2" as="p">
          Preset
        </Text>
        <Flex gap="2" wrap="wrap">
          {PRESETS.map((p) => (
            <Button
              key={p.label}
              variant="outline"
              size="sm"
              onClick={() =>
                setSteps(p.steps.map((s) => ({ ...s, patch: { ...s.patch } })))
              }
            >
              {p.label}
            </Button>
          ))}
        </Flex>
      </Box>

      {/* ── START ──────────────────────────────────────────────────── */}
      <SectionLabel>Start</SectionLabel>
      <div style={anchorCardStyle}>
        <Field
          label="Auto-start date (optional)"
          helpText="Leave blank to start manually. When set, the ramp starts automatically at this time."
          type="datetime-local"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
        />
      </div>

      {/* ── STEPS ──────────────────────────────────────────────────── */}
      <SectionLabel>Steps</SectionLabel>

      {steps.length === 0 && (
        <Text color="text-low" as="p" mb="2">
          No intermediate steps — ramp goes directly from start to end.
        </Text>
      )}

      {steps.map((step, i) => (
        <div key={i} style={stepCardStyle}>
          <Flex justify="between" align="center" mb="2">
            <Text weight="medium" color="text-low">
              Step {i + 1}
            </Text>
            <IconButton
              variant="ghost"
              color="red"
              size="1"
              onClick={() => removeStep(i)}
              disabled={steps.length <= 1}
            >
              <PiTrashBold />
            </IconButton>
          </Flex>

          <Flex gap="2" align="center" mb="3" wrap="wrap">
            <Box style={{ width: 120 }}>
              <SelectField
                label="Trigger"
                value={step.triggerType}
                options={[
                  { value: "interval", label: "Timed" },
                  { value: "approval", label: "Approval" },
                ]}
                onChange={(v) =>
                  updateStep(i, { triggerType: v as "interval" | "approval" })
                }
              />
            </Box>
            {step.triggerType === "interval" ? (
              <Flex gap="1" align="center" style={{ marginTop: 20 }}>
                <Text color="text-low">after</Text>
                <input
                  type="number"
                  min={1}
                  value={step.intervalValue}
                  onChange={(e) =>
                    updateStep(i, {
                      intervalValue: Math.max(1, parseInt(e.target.value) || 1),
                    })
                  }
                  style={{ ...fieldInputStyle, width: 60 }}
                />
                <SelectField
                  value={step.intervalUnit}
                  options={[
                    { value: "minutes", label: "minutes" },
                    { value: "hours", label: "hours" },
                  ]}
                  onChange={(v) =>
                    updateStep(i, { intervalUnit: v as IntervalUnit })
                  }
                  containerClassName="mb-0"
                />
              </Flex>
            ) : (
              <span style={{ marginTop: 20 }}>
                <Text color="text-low">
                  Waits for manual approval before advancing
                </Text>
              </span>
            )}
          </Flex>

          <Text
            size="small"
            weight="semibold"
            color="text-low"
            as="p"
            textTransform="uppercase"
            mb="1"
          >
            Changes
          </Text>
          <PatchEditor
            patch={step.patch}
            onUpdateField={(field, value) =>
              updateStepPatchField(i, field, value)
            }
            onRemoveField={(field) => removeStepPatchField(i, field)}
            onAddField={(field) => addStepPatchField(i, field)}
            feature={feature}
            fieldInputStyle={fieldInputStyle}
          />
        </div>
      ))}

      <Box mb="4">
        <Button
          variant="outline"
          size="sm"
          icon={<PiPlusBold />}
          onClick={addStep}
        >
          Add step
        </Button>
      </Box>

      {/* ── END ────────────────────────────────────────────────────── */}
      <SectionLabel>End</SectionLabel>
      <div style={anchorCardStyle}>
        <Field
          label="Auto-end date (optional)"
          helpText="When reached, applies the changes below (if any) and marks the ramp complete."
          type="datetime-local"
          value={endScheduleAt}
          onChange={(e) => setEndScheduleAt(e.target.value)}
        />
        <Text
          size="small"
          weight="semibold"
          color="text-low"
          as="p"
          textTransform="uppercase"
          mt="1"
          mb="1"
        >
          Changes at end (optional)
        </Text>
        <PatchEditor
          patch={endSchedulePatch}
          onUpdateField={updateEndPatchField}
          onRemoveField={removeEndPatchField}
          onAddField={addEndPatchField}
          feature={feature}
          fieldInputStyle={fieldInputStyle}
        />
      </div>
    </Modal>
  );
}
