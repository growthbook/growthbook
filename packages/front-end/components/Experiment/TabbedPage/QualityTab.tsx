import { FC, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  ExperimentQualityCheckResult,
  ExperimentQualitySectionResult,
  QUALITY_CHECK_PASS_THRESHOLD,
} from "shared/enterprise";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { date } from "shared/dates";
import { PiPencilSimpleFill } from "react-icons/pi";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Field from "@/components/Forms/Field";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { ExperimentQualityScoreHookResult } from "@/hooks/useExperimentQualityScore";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useAuth } from "@/services/auth";
import ScoreRing from "@/components/Experiment/Quality/ScoreRing";
import {
  SECTION_COLORS,
  getScoreTier,
  scaleColors,
} from "@/components/Experiment/Quality/qualityDisplay";
import { ExperimentTab } from "./index";

const CheckResultCell: FC<{
  check: ExperimentQualityCheckResult;
  editMetrics?: (() => void) | null;
  setTabAndScroll: (tab: ExperimentTab, scrollToId?: string) => void;
}> = ({ check, editMetrics, setTabAndScroll }) => {
  if (!check.applicable) {
    return (
      <Text size="md" color="text-low">
        —
      </Text>
    );
  }

  // Fix links for failing/partial checks
  const fixLink = (() => {
    switch (check.key) {
      case "hypothesis":
        return (
          <Link onClick={() => setTabAndScroll("overview", "hypothesis")}>
            Add hypothesis
          </Link>
        );
      case "description":
        return (
          <Link onClick={() => setTabAndScroll("overview", "description")}>
            Add description
          </Link>
        );
      case "screenshots":
        return (
          <Link onClick={() => setTabAndScroll("overview", "variations")}>
            Add screenshots
          </Link>
        );
      case "goal-metrics":
        return editMetrics ? (
          <Link onClick={() => editMetrics()}>Edit Metrics</Link>
        ) : null;
      case "health-powered":
        return <Link href="/power-calculator">Power Calculator</Link>;
      case "ai-hypothesis-quality":
      case "ai-hypothesis-metric-alignment":
        return (
          <Link onClick={() => setTabAndScroll("overview", "hypothesis")}>
            Edit Hypothesis
          </Link>
        );
      case "tags-or-project":
      case "owner":
      case "decision":
      case "learnings":
      case "health-no-issues":
      case "goal-metrics-locked":
      case "hypothesis-locked":
      case "stable-assignment":
      case "stable-analysis":
      case "no-early-stop":
      case "clean-restarts":
      case "planned-end":
      case "ai-learnings-quality":
        return null;
    }
  })();

  if (check.type === "ai") {
    if (check.score === null) {
      return (
        <Text size="md" color="text-low">
          pending
        </Text>
      );
    }
    return (
      <span
        style={{
          color: scaleColors(getScoreTier(check.score * 100)).text,
          fontVariantNumeric: "tabular-nums",
          fontSize: 13,
        }}
      >
        {check.score.toFixed(1)}
      </span>
    );
  }

  if (check.score === null) {
    return (
      <Text size="md" color="text-low">
        {check.type === "process" ? "calculating" : "—"}
      </Text>
    );
  }

  if (check.score >= QUALITY_CHECK_PASS_THRESHOLD) {
    return (
      <span style={{ color: scaleColors("green").text, fontSize: 13 }}>✓</span>
    );
  }

  // Failed deterministic check: under-powered reads as amber per the
  // design; everything else is a red ✕ with reason + fix link
  const isAmber = check.key === "health-powered";
  return (
    <span
      style={{
        color: scaleColors(isAmber ? "amber" : "red").text,
        fontSize: 13,
      }}
    >
      {isAmber ? (check.reason ?? "Underpowered") : "✕"}
      {!isAmber && check.reason ? ` ${check.reason}` : ""}
      {check.evidence?.user ? ` by ${check.evidence.user}` : ""}
      {check.evidence?.date ? ` on ${date(check.evidence.date)}` : ""}
      {fixLink ? <> · {fixLink}</> : null}
    </span>
  );
};

const SectionCard: FC<{
  section: ExperimentQualitySectionResult;
  editMetrics?: (() => void) | null;
  setTabAndScroll: (tab: ExperimentTab, scrollToId?: string) => void;
  // Shown when nothing in the section applies
  notApplicableLabel: string;
}> = ({ section, editMetrics, setTabAndScroll, notApplicableLabel }) => {
  const color = SECTION_COLORS[section.key];
  return (
    <Box
      p="4"
      style={{
        border: "1px solid var(--border-color-200)",
        borderRadius: 8,
        background: "var(--color-panel)",
        opacity: section.applicable ? 1 : 0.55,
      }}
    >
      <Flex justify="between" align="center">
        <span style={{ color: color.text, fontSize: 13.5, fontWeight: 600 }}>
          {section.label}
        </span>
        {section.applicable ? (
          <span
            style={{
              fontVariantNumeric: "tabular-nums",
              fontSize: 13.5,
              fontWeight: 600,
            }}
          >
            {Math.round(section.earnedPoints)} /{" "}
            {Math.round(section.possiblePoints)}
          </span>
        ) : (
          <Text size="sm" color="text-mid">
            {notApplicableLabel}
          </Text>
        )}
      </Flex>
      <Flex direction="column" gap="1" mt="2">
        {section.checks.map((check) => (
          <Box key={check.key}>
            <Flex justify="between" align="center" gap="3">
              <Text
                size="md"
                color={check.applicable ? "text-high" : "text-mid"}
              >
                {check.label}
                {check.key === "goal-metrics" && check.params?.maxGoalMetrics
                  ? ` · fewer than ${check.params.maxGoalMetrics}`
                  : ""}
                {check.key === "no-early-stop" && check.params?.minRuntimeDays
                  ? ` · or before ${check.params.minRuntimeDays} days without a scheduled end`
                  : ""}
              </Text>
              <CheckResultCell
                check={check}
                editMetrics={editMetrics}
                setTabAndScroll={setTabAndScroll}
              />
            </Flex>
            {check.type === "ai" && check.applicable && check.reason && (
              <Text size="sm" color="text-low" as="p" mb="0" fontStyle="italic">
                {check.reason}
              </Text>
            )}
          </Box>
        ))}
      </Flex>
      {section.key === "ai" && (
        <Box
          mt="2"
          pt="2"
          style={{ borderTop: "1px solid var(--border-color-100)" }}
        >
          <Text size="sm" color="text-low">
            Verdicts update automatically when the hypothesis, Metrics, or
            learnings change.
          </Text>
        </Box>
      )}
    </Box>
  );
};

const QualityTab: FC<{
  experiment: ExperimentInterfaceStringDates;
  quality: ExperimentQualityScoreHookResult | null;
  mutate: () => void;
  editMetrics?: (() => void) | null;
  setTabAndScroll: (tab: ExperimentTab, scrollToId?: string) => void;
}> = ({ experiment, quality, mutate, editMetrics, setTabAndScroll }) => {
  const permissionsUtil = usePermissionsUtil();
  const { apiCall } = useAuth();
  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [overrideScore, setOverrideScore] = useState<number>(
    quality?.result.score ?? 50,
  );
  const [overrideReason, setOverrideReason] = useState("");

  if (!quality) return null;
  const { result, configName } = quality;

  const canOverride =
    permissionsUtil.canUpdateExperiment(experiment, {}) && !experiment.archived;

  const running = experiment.status === "running";
  const statusLabel = experiment.status === "draft" ? "in draft" : "running";
  const resultsJoinNote =
    result.appliedCheckCount < result.totalEnabledCheckCount && running
      ? " Decision, learnings and process checks join the score when it stops."
      : "";

  const displayScore = result.score;

  async function submitOverride(score: number | null, reason?: string) {
    await apiCall(
      `/experiment-quality-score/experiment/${experiment.id}/override`,
      {
        method: "POST",
        body: JSON.stringify({ score, ...(reason ? { reason } : {}) }),
      },
    );
    mutate();
  }

  return (
    <Box mt="4">
      {overrideModalOpen && (
        <ModalStandard
          open
          trackingEventModalType="experiment-quality-override"
          header="Override Quality Score"
          cta="Set score"
          close={() => setOverrideModalOpen(false)}
          submit={async () => {
            await submitOverride(overrideScore, overrideReason);
            setOverrideModalOpen(false);
          }}
        >
          <Field
            label="Score (0–100)"
            type="number"
            min={0}
            max={100}
            value={overrideScore}
            onChange={(e) =>
              setOverrideScore(
                Math.min(100, Math.max(0, parseInt(e.target.value) || 0)),
              )
            }
          />
          <Field
            label="Reason (optional)"
            textarea
            minRows={2}
            value={overrideReason}
            onChange={(e) => setOverrideReason(e.target.value)}
            placeholder="Why is this score being set manually?"
          />
          <Text size="sm" color="text-mid">
            The override replaces the computed score everywhere it is shown. You
            can remove it at any time.
          </Text>
        </ModalStandard>
      )}

      <Flex justify="between" align="center" mb="4" gap="3">
        <Heading as="h2" size="md" mb="0">
          Quality Score
        </Heading>
        <Flex align="center" gap="3">
          <Text size="sm" color="text-low">
            Scored with{" "}
            {configName
              ? `the ${configName} configuration`
              : "the GrowthBook default configuration"}{" "}
            ·{" "}
            <Link href="/settings/experimentation-health#quality">
              view configuration
            </Link>
          </Text>
          {canOverride && !result.override && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setOverrideScore(result.score ?? 50);
                setOverrideModalOpen(true);
              }}
            >
              Override score
            </Button>
          )}
        </Flex>
      </Flex>

      {/* Summary card */}
      <Flex
        gap="4"
        align="center"
        p="4"
        mb="4"
        style={{
          border: "1px solid var(--border-color-200)",
          borderRadius: 8,
          background: "var(--color-panel)",
        }}
      >
        {displayScore !== null ? (
          <ScoreRing
            score={displayScore}
            color={scaleColors(getScoreTier(displayScore)).bar}
          />
        ) : (
          <ScoreRing score={0} color="var(--slate-8)" />
        )}
        <Box flexGrow="1">
          <Flex align="center" gap="2">
            <Text size="md" weight="semibold">
              {displayScore !== null
                ? `${displayScore} out of 100`
                : "Not scored yet"}
            </Text>
            {result.override && (
              <Badge
                label={
                  <Flex align="center" gap="1" display="inline-flex">
                    <PiPencilSimpleFill size={10} />
                    <span>Manually set</span>
                  </Flex>
                }
                color="violet"
                variant="soft"
                radius="full"
                size="xs"
              />
            )}
          </Flex>
          {result.override ? (
            <Text size="sm" color="text-mid" as="p" mb="0">
              Set to {result.override.score}
              {result.override.userName
                ? ` by ${result.override.userName}`
                : ""}
              {result.override.dateOverridden
                ? ` on ${date(result.override.dateOverridden)}`
                : ""}
              {result.override.reason ? ` · ${result.override.reason}` : ""}
              {result.computedScore !== null
                ? ` · Computed: ${result.computedScore}`
                : ""}{" "}
              {canOverride && (
                <Link onClick={() => submitOverride(null)}>
                  Remove override
                </Link>
              )}
            </Text>
          ) : (
            <Text size="sm" color="text-mid" as="p" mb="0">
              {result.appliedCheckCount} of {result.totalEnabledCheckCount}{" "}
              checks apply while this experiment is {statusLabel}.
              {resultsJoinNote}
              {result.pending ? " AI checks are still pending." : ""}
            </Text>
          )}
        </Box>
        <Flex gap="3" flexShrink="0" wrap="wrap">
          {result.sections
            .filter((s) => s.enabled && s.applicable)
            .map((s) => (
              <Flex key={s.key} align="center" gap="1">
                <span
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    background: SECTION_COLORS[s.key].bar,
                  }}
                />
                <Text size="sm" color="text-mid">
                  {s.label} {Math.round(s.earnedPoints)}/
                  {Math.round(s.possiblePoints)}
                </Text>
              </Flex>
            ))}
        </Flex>
      </Flex>

      {/* Rubric cards */}
      <Flex direction="column" gap="3">
        {result.sections
          .filter((s) => s.enabled)
          .map((section) => (
            <SectionCard
              key={section.key}
              section={section}
              editMetrics={editMetrics}
              setTabAndScroll={setTabAndScroll}
              notApplicableLabel={
                experiment.status === "stopped"
                  ? "Not applicable"
                  : `Not applicable while ${statusLabel}`
              }
            />
          ))}
      </Flex>
    </Box>
  );
};

export default QualityTab;
