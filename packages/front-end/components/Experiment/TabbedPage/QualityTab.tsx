import { FC, ReactNode, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  ExperimentQualityCheckResult,
  ExperimentQualityScoreResult,
  ExperimentQualitySectionResult,
  QUALITY_CHECK_PASS_THRESHOLD,
  getQualityImprovements,
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
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useAuth } from "@/services/auth";
import ScoreRing from "@/components/Experiment/Quality/ScoreRing";
import {
  SECTION_COLORS,
  getScoreTier,
  scaleColors,
} from "@/components/Experiment/Quality/qualityDisplay";
import { ExperimentTab } from "./index";

type FixAction = { label: string } & (
  | { onClick: () => void }
  | { href: string }
);

// Where to fix a failing check, when it can be fixed from the experiment
function getFixAction(
  check: Pick<ExperimentQualityCheckResult, "key">,
  editMetrics: (() => void) | null | undefined,
  setTabAndScroll: (tab: ExperimentTab, scrollToId?: string) => void,
): FixAction | null {
  switch (check.key) {
    case "hypothesis":
      return {
        label: "Add hypothesis",
        onClick: () => setTabAndScroll("overview", "hypothesis"),
      };
    case "description":
      return {
        label: "Add description",
        onClick: () => setTabAndScroll("overview", "description"),
      };
    case "screenshots":
      return {
        label: "Add screenshots",
        onClick: () => setTabAndScroll("overview", "variations"),
      };
    case "goal-metrics":
    case "guardrail-metrics":
      return editMetrics
        ? { label: "Edit metrics", onClick: editMetrics }
        : null;
    case "max-variations":
      return {
        label: "Edit variations",
        onClick: () => setTabAndScroll("overview", "variations"),
      };
    case "ai-hypothesis-quality":
    case "ai-hypothesis-metric-alignment":
      return {
        label: "Edit hypothesis",
        onClick: () => setTabAndScroll("overview", "hypothesis"),
      };
    case "tags-or-project":
    case "decision":
    case "analysis-written":
    case "goal-metrics-locked":
    case "hypothesis-locked":
    case "stable-assignment":
    case "stable-analysis":
    case "no-early-stop":
    case "clean-restarts":
    case "planned-end":
      return null;
  }
  // Custom AI checks
  return null;
}

const FixLink: FC<{ action: FixAction; children?: ReactNode }> = ({
  action,
  children,
}) =>
  "href" in action ? (
    <Link href={action.href}>{children ?? action.label}</Link>
  ) : (
    <Link onClick={action.onClick}>{children ?? action.label}</Link>
  );

// The action that fixes a check, for "How to improve this score"
function describeImprovement(check: ExperimentQualityCheckResult): string {
  if (check.key.startsWith("custom:")) return `Meet “${check.label}”`;
  switch (check.key) {
    case "hypothesis":
      return "Add a hypothesis";
    case "description":
      return "Add a description";
    case "screenshots":
      return "Add screenshots of the variations";
    case "tags-or-project":
      return "Add tags or a Project";
    case "goal-metrics":
      return check.reason?.startsWith("No goal")
        ? "Add goal metrics"
        : "Use fewer goal metrics";
    case "guardrail-metrics":
      return "Add guardrail metrics";
    case "max-variations":
      return "Use fewer variations";
    case "decision":
      return "Record a decision";
    case "analysis-written":
      return "Write up the analysis";
    case "ai-hypothesis-quality":
      return "Strengthen the hypothesis";
    case "ai-hypothesis-metric-alignment":
      return "Choose goal metrics that measure what the hypothesis predicts";
    // Process checks aren't listed: they can't change after the fact
    case "goal-metrics-locked":
    case "hypothesis-locked":
    case "stable-assignment":
    case "stable-analysis":
    case "no-early-stop":
    case "clean-restarts":
    case "planned-end":
      return check.label;
  }
  return check.label;
}

const ImprovementsCard: FC<{
  result: ExperimentQualityScoreResult;
  editMetrics?: (() => void) | null;
  setTabAndScroll: (tab: ExperimentTab, scrollToId?: string) => void;
}> = ({ result, editMetrics, setTabAndScroll }) => {
  const improvements = getQualityImprovements(result).slice(0, 5);
  if (!improvements.length) return null;
  return (
    <Box
      p="4"
      mb="4"
      style={{
        border: "1px solid var(--border-color-200)",
        borderRadius: 8,
        background: "var(--color-panel)",
      }}
    >
      <Text size="md" weight="semibold">
        How to improve this score
      </Text>
      <Flex direction="column" gap="2" mt="2">
        {improvements.map((check) => {
          const fix = getFixAction(check, editMetrics, setTabAndScroll);
          const action = describeImprovement(check);
          return (
            <Flex key={check.key} gap="3" align="start">
              <span
                style={{
                  minWidth: 32,
                  color: scaleColors("green").text,
                  fontVariantNumeric: "tabular-nums",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                +{Math.round(check.gain)}
              </span>
              <Box>
                <Text size="md">
                  {fix ? <FixLink action={fix}>{action}</FixLink> : action}
                </Text>
                {check.reason && check.key !== "hypothesis" && (
                  <Text as="p" size="sm" color="text-mid" mb="0">
                    {check.reason}
                  </Text>
                )}
              </Box>
            </Flex>
          );
        })}
      </Flex>
    </Box>
  );
};

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

  const fix = getFixAction(check, editMetrics, setTabAndScroll);

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

  return (
    <span style={{ color: scaleColors("red").text, fontSize: 13 }}>
      ✕{check.reason ? ` ${check.reason}` : ""}
      {check.evidence?.user ? ` by ${check.evidence.user}` : ""}
      {check.evidence?.date ? ` on ${date(check.evidence.date)}` : ""}
      {fix ? (
        <>
          {" "}
          · <FixLink action={fix} />
        </>
      ) : null}
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
                {check.key === "max-variations" && check.params?.maxVariations
                  ? ` · at most ${check.params.maxVariations}`
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
            Verdicts update automatically when the experiment changes.
          </Text>
        </Box>
      )}
    </Box>
  );
};

const QualityTab: FC<{
  experiment: ExperimentInterfaceStringDates;
  result: ExperimentQualityScoreResult | null;
  mutate: () => void;
  editMetrics?: (() => void) | null;
  setTabAndScroll: (tab: ExperimentTab, scrollToId?: string) => void;
}> = ({ experiment, result, mutate, editMetrics, setTabAndScroll }) => {
  const permissionsUtil = usePermissionsUtil();
  const { apiCall } = useAuth();
  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [overrideScore, setOverrideScore] = useState<number>(
    result?.score ?? 50,
  );
  const [overrideReason, setOverrideReason] = useState("");

  if (!result) return null;

  const canOverride =
    permissionsUtil.canUpdateExperiment(experiment, {}) && !experiment.archived;

  const running = experiment.status === "running";
  const statusLabel =
    experiment.status === "draft" ? "in draft" : experiment.status;
  const resultsJoinNote =
    result.appliedCheckCount < result.totalEnabledCheckCount && running
      ? " Decision and process checks join the score when it stops."
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
            <Link href="/settings/experimentation-health">
              How the score is calculated
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

      {!result.override && (
        <ImprovementsCard
          result={result}
          editMetrics={editMetrics}
          setTabAndScroll={setTabAndScroll}
        />
      )}

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
