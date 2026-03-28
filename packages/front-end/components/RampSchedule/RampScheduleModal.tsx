/**
 * Standalone create/edit modal for ramp schedules.
 *
 * Delegates all step-editing UI to RampScheduleSection (the same polished
 * editor used inside RuleModal). No target setup — implementations are
 * attached via the per-rule RuleModal. Shows a warning callout when the
 * ramp has no implementations yet.
 */

import { useState } from "react";
import type { FeatureInterface } from "shared/types/feature";
import type { Environment } from "shared/types/organization";
import type { RampScheduleInterface } from "shared/validators";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import Callout from "@/ui/Callout";
import RampScheduleSection, {
  type RampSectionState,
  defaultRampSectionState,
  rampScheduleToSectionState,
  buildPatch,
  type UIStep,
  type UIStepPatch,
} from "@/components/Features/RuleModal/RampScheduleSection";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  /** When provided: edit mode (PUT). When absent: create mode (POST). */
  rs?: RampScheduleInterface;
  feature: FeatureInterface;
  environments: Environment[];
  onSave: () => Promise<unknown>;
  onClose: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Build steps for ALL targets, syncing each target's action patch from the UIStep patches.
function buildStepsForAllTargets(
  steps: UIStep[],
  targets: RampScheduleInterface["targets"],
  existingSteps: RampScheduleInterface["steps"],
) {
  const UNIT_MULT = { minutes: 60, hours: 3600, days: 86400 } as const;
  return steps.map((s, i) => {
    const existingStep = existingSteps[i];
    const actions = targets.map((t) => {
      const ruleId = t.ruleId ?? "";
      const base = buildPatch(s.patch, ruleId) as Record<string, unknown>;
      // Preserve savedGroups/prerequisites from existing actions — they are
      // edited via the per-rule surface, not from this shared editor.
      const existingAction = existingStep?.actions?.find(
        (a) => a.targetId === t.id,
      );
      if (base.savedGroups === undefined && existingAction?.patch.savedGroups) {
        base.savedGroups = existingAction.patch.savedGroups;
      }
      if (
        base.prerequisites === undefined &&
        existingAction?.patch.prerequisites
      ) {
        base.prerequisites = existingAction.patch.prerequisites;
      }
      return {
        targetType: "feature-rule" as const,
        targetId: t.id,
        patch: base,
      };
    });

    const trigger =
      s.triggerType === "interval"
        ? {
            type: "interval" as const,
            seconds: s.intervalValue * UNIT_MULT[s.intervalUnit],
          }
        : { type: "approval" as const };

    return {
      trigger,
      actions,
      ...(s.triggerType === "approval" && s.approvalNotes
        ? { approvalNotes: s.approvalNotes }
        : {}),
    };
  });
}

// Build start/end condition actions for ALL targets from a shared UIStepPatch,
// preserving savedGroups/prerequisites from each existing action when absent.
function buildConditionActionsForAllTargets(
  patch: UIStepPatch,
  targets: RampScheduleInterface["targets"],
  existingActions: RampScheduleInterface["startCondition"]["actions"],
) {
  const hasAny = Object.values(patch).some((v) => v !== undefined);
  if (!hasAny) return undefined;
  return targets.map((t) => {
    const ruleId = t.ruleId ?? "";
    const base = buildPatch(patch, ruleId) as Record<string, unknown>;
    const existing = existingActions?.find((a) => a.targetId === t.id);
    if (base.savedGroups === undefined && existing?.patch.savedGroups) {
      base.savedGroups = existing.patch.savedGroups;
    }
    if (base.prerequisites === undefined && existing?.patch.prerequisites) {
      base.prerequisites = existing.patch.prerequisites;
    }
    return { targetType: "feature-rule" as const, targetId: t.id, patch: base };
  });
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function RampScheduleModal({
  rs,
  feature,
  environments,
  onSave,
  onClose,
}: Props) {
  const { apiCall } = useAuth();
  const isEdit = !!rs;
  const noImplementations = isEdit && (rs.targets.length ?? 0) === 0;
  const multiTarget = isEdit && rs.targets.length > 1;

  // ── Ramp section state ───────────────────────────────────────────────────
  const [rampState, setRampState] = useState<RampSectionState>(() =>
    rs
      ? rampScheduleToSectionState(rs)
      : { ...defaultRampSectionState(undefined), mode: "create" },
  );

  // ── Save ─────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (!rampState.name.trim()) throw new Error("Ramp name is required");

    const startTrigger =
      rampState.startMode === "manual"
        ? ({ type: "manual" } as const)
        : rampState.startMode === "specific-time" && rampState.startTime
          ? ({ type: "scheduled", at: rampState.startTime } as const)
          : ({ type: "immediately" } as const);

    if (isEdit) {
      const startActions = buildConditionActionsForAllTargets(
        rampState.startPatch,
        rs.targets,
        rs.startCondition?.actions ?? [],
      );
      const endActions = buildConditionActionsForAllTargets(
        rampState.endSchedulePatch,
        rs.targets,
        rs.endCondition?.actions ?? [],
      );

      await apiCall(`/ramp-schedule/${rs.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: rampState.name.trim(),
          steps: buildStepsForAllTargets(rampState.steps, rs.targets, rs.steps),
          startCondition: {
            trigger: startTrigger,
            actions: startActions ?? undefined,
          },
          disableRuleBefore: rampState.disableRuleBefore || undefined,
          disableRuleAfter: rampState.disableRuleAfter || undefined,
          endEarlyWhenStepsComplete: rampState.endEarlyWhenStepsComplete,
          endCondition: rampState.endScheduleAt
            ? {
                trigger: {
                  type: "scheduled" as const,
                  at: rampState.endScheduleAt,
                },
                actions: endActions ?? undefined,
              }
            : endActions
              ? { actions: endActions }
              : undefined,
        }),
      });
    } else {
      // Create with no targets — store triggers and empty action arrays.
      // Action patches are populated when implementations are attached via RuleModal.
      const UNIT_MULT = { minutes: 60, hours: 3600, days: 86400 } as const;
      await apiCall("/ramp-schedule", {
        method: "POST",
        body: JSON.stringify({
          name: rampState.name.trim(),
          entityType: "feature",
          entityId: feature.id,
          targets: [],
          steps: rampState.steps.map((s) => ({
            trigger:
              s.triggerType === "interval"
                ? {
                    type: "interval" as const,
                    seconds: s.intervalValue * UNIT_MULT[s.intervalUnit],
                  }
                : { type: "approval" as const },
            actions: [],
            ...(s.triggerType === "approval" && s.approvalNotes
              ? { approvalNotes: s.approvalNotes }
              : {}),
          })),
          startCondition: {
            trigger: startTrigger,
          },
          disableRuleBefore: rampState.disableRuleBefore || undefined,
          disableRuleAfter: rampState.disableRuleAfter || undefined,
          endEarlyWhenStepsComplete: rampState.endEarlyWhenStepsComplete,
          endCondition: rampState.endScheduleAt
            ? {
                trigger: {
                  type: "scheduled" as const,
                  at: rampState.endScheduleAt,
                },
              }
            : undefined,
        }),
      });
    }

    await onSave();
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Modal
      open
      close={onClose}
      header={isEdit ? `Edit: ${rs.name}` : "Create Ramp Schedule"}
      size="lg"
      submit={handleSubmit}
      cta={isEdit ? "Save" : "Create"}
      trackingEventModalType="ramp-schedule-modal"
    >
      {noImplementations && (
        <Callout status="warning" mb="3">
          This ramp has no implementations yet. Link it to a rollout rule from
          the rule editor to start applying it.
        </Callout>
      )}

      {multiTarget && (
        <Callout status="info" mb="3">
          This ramp has {rs.targets.length} implementations. Saving will apply
          these step settings to all of them.
        </Callout>
      )}

      <RampScheduleSection
        featureRampSchedules={[]}
        ruleRampSchedule={rs}
        state={rampState}
        setState={setRampState}
        hideOuterToggle
        boxStepGrid
        hideNameField
        feature={feature}
        environments={environments.map((e) => e.id)}
      />
    </Modal>
  );
}
