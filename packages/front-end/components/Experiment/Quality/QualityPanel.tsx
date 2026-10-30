import { ReactNode, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  PiCaretDown,
  PiCaretUp,
  PiCheck,
  PiCircleDashed,
  PiCircleHalfFill,
  PiInfo,
  PiPencilSimple,
  PiTrendUp,
  PiX,
} from "react-icons/pi";
import {
  ExperimentQualityCheckResult,
  ExperimentQualityScoreResult,
  ExperimentQualitySectionResult,
  QUALITY_CHECK_PASS_THRESHOLD,
  getQualityImprovements,
  getQualitySummaryKey,
  getQualitySummaryTemplate,
} from "shared/enterprise";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { date } from "shared/dates";
import Collapse from "@/ui/Collapse";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import {
  DropdownMenu,
  DropdownMenuItem,
  MoreMenuTrigger,
} from "@/ui/DropdownMenu";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useAuth } from "@/services/auth";
import QualityDonut from "./QualityDonut";
import OverrideScoreModal from "./OverrideScoreModal";
import { BAND_DISPLAY, getBandDisplay } from "./qualityDisplay";
import {
  QualityFixTargets,
  describeQualityFix,
  getQualityFixAction,
} from "./qualityFixes";
import styles from "./Quality.module.scss";

const MAX_FIXES = 5;

const rounded = (points: number) => Math.round(points);

function Disclosure({
  open,
  setOpen,
  header,
  children,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  header: ReactNode;
  children: ReactNode;
}) {
  return (
    <Box className={styles.panel}>
      <button
        type="button"
        className={styles.panelTrigger}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Flex align="center" gap="2" flexGrow="1" minWidth="0">
          {header}
        </Flex>
        {open ? <PiCaretUp /> : <PiCaretDown />}
      </button>
      <Collapse open={open}>
        <Box px="4" pb="3">
          {children}
        </Box>
      </Collapse>
    </Box>
  );
}

function CheckMark({ check }: { check: ExperimentQualityCheckResult }) {
  if (!check.applicable) {
    return <Text color="text-low">–</Text>;
  }
  if (check.score === null) {
    return (
      <PiCircleDashed color="var(--gray-9)" role="img" aria-label="Pending" />
    );
  }
  if (check.score >= 0.999) {
    return <PiCheck color="var(--green-11)" role="img" aria-label="Passed" />;
  }
  if (check.score >= QUALITY_CHECK_PASS_THRESHOLD || check.score > 0) {
    return (
      <PiCircleHalfFill
        color={
          check.score >= QUALITY_CHECK_PASS_THRESHOLD
            ? "var(--green-11)"
            : "var(--red-11)"
        }
        role="img"
        aria-label="Partly passed"
      />
    );
  }
  return <PiX color="var(--red-11)" role="img" aria-label="Failed" />;
}

function CheckDetail({
  check,
  targets,
  implementationId,
  aiDate,
}: {
  check: ExperimentQualityCheckResult;
  targets: QualityFixTargets;
  implementationId: string;
  aiDate: string | null;
}) {
  const fix = getQualityFixAction(check, targets, implementationId);
  const evidence = [
    check.evidence?.user ? `by ${check.evidence.user}` : "",
    check.evidence?.date ? `on ${date(check.evidence.date)}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <Box className={styles.checkDetail}>
      <Flex justify="between" gap="2">
        <Text size="sm" color="text-mid">
          {rounded(check.earnedPoints)}/{rounded(check.possiblePoints)} pts
        </Text>
        {check.type === "ai" && aiDate ? (
          <Text size="sm" color="text-low">
            AI · {aiDate}
          </Text>
        ) : null}
      </Flex>
      {check.reason ? (
        <Text as="p" size="sm" mb="0">
          {check.reason.replace(/\.$/, "")}
          {evidence ? `, ${evidence}` : ""}.
        </Text>
      ) : null}
      {fix ? (
        <Box mt="1">
          <Link onClick={fix.onClick}>{fix.label}</Link>
        </Box>
      ) : null}
    </Box>
  );
}

function SectionRow({
  section,
  scored,
  targets,
  implementationId,
  aiDate,
}: {
  section: ExperimentQualitySectionResult;
  // Before the start, points aren't shown
  scored: boolean;
  targets: QualityFixTargets;
  implementationId: string;
  aiDate: string | null;
}) {
  const [open, setOpen] = useState(false);
  const failing = (check: ExperimentQualityCheckResult) =>
    check.applicable &&
    check.score !== null &&
    check.score < QUALITY_CHECK_PASS_THRESHOLD;
  // Failing checks start open, so what's wrong reads without a click
  const [closedChecks, setClosedChecks] = useState<Set<string>>(new Set());
  const fill =
    section.possiblePoints > 0
      ? (section.earnedPoints / section.possiblePoints) * 100
      : 0;

  if (!section.applicable) {
    const tooltip =
      section.key === "process"
        ? {
            title: "Scored when the experiment stops",
            body: "Process checks look at what happened while it ran, like whether settings changed or it stopped early.",
          }
        : {
            title: "Nothing to score yet",
            body: "None of this section's checks apply to the experiment yet.",
          };
    return (
      <Box className={styles.section}>
        <div className={styles.sectionTrigger} aria-disabled="true">
          <Flex align="center" gap="1">
            <Text color="text-low" weight="semibold">
              {section.label}
            </Text>
            <Tooltip
              content={
                <>
                  <strong>{tooltip.title}</strong>
                  <br />
                  {tooltip.body}
                </>
              }
            >
              <PiInfo
                tabIndex={0}
                aria-label={tooltip.title}
                color="var(--gray-10)"
              />
            </Tooltip>
          </Flex>
          <div className={styles.bar} />
          <span />
          <span />
        </div>
      </Box>
    );
  }

  return (
    <Box className={styles.section}>
      <button
        type="button"
        className={styles.sectionTrigger}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Text weight="semibold">{section.label}</Text>
        <div className={styles.bar}>
          <div className={styles.barFill} style={{ width: `${fill}%` }} />
        </div>
        <span className={styles.points}>
          {scored
            ? `${rounded(section.earnedPoints)}/${rounded(section.possiblePoints)}`
            : ""}
        </span>
        {open ? <PiCaretUp /> : <PiCaretDown />}
      </button>
      <Collapse open={open}>
        <Flex direction="column" px="5" pb="3">
          {section.checks.map((check) => {
            const label = (
              <Text
                color={check.applicable ? "text-high" : "text-low"}
                weight={failing(check) ? "semibold" : "regular"}
              >
                {check.label}
              </Text>
            );
            if (!failing(check)) {
              return (
                <div key={check.key} className={styles.checkRow}>
                  {label}
                  <CheckMark check={check} />
                </div>
              );
            }
            const expanded = !closedChecks.has(check.key);
            return (
              <Box key={check.key}>
                <button
                  type="button"
                  className={styles.checkRow}
                  aria-expanded={expanded}
                  onClick={() =>
                    setClosedChecks((closed) => {
                      const next = new Set(closed);
                      if (expanded) next.add(check.key);
                      else next.delete(check.key);
                      return next;
                    })
                  }
                >
                  {label}
                  <CheckMark check={check} />
                </button>
                {expanded ? (
                  <CheckDetail
                    check={check}
                    targets={targets}
                    implementationId={implementationId}
                    aiDate={aiDate}
                  />
                ) : null}
              </Box>
            );
          })}
        </Flex>
      </Collapse>
    </Box>
  );
}

export default function QualityPanel({
  experiment,
  result,
  mutate,
  targets,
  implementationId,
}: {
  experiment: ExperimentInterfaceStringDates;
  result: ExperimentQualityScoreResult;
  mutate: () => void;
  targets: QualityFixTargets;
  implementationId: string;
}) {
  const permissionsUtil = usePermissionsUtil();
  const { apiCall } = useAuth();
  const draft = experiment.status === "draft";
  const [fixesOpen, setFixesOpen] = useState(draft);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideModal, setOverrideModal] = useState(false);

  const canOverride =
    !draft &&
    !experiment.archived &&
    permissionsUtil.canUpdateExperiment(experiment, {});
  const override = result.override;
  const score = draft ? null : result.score;
  const band = score === null ? null : getBandDisplay(score);

  const fixes = getQualityImprovements(result).slice(0, MAX_FIXES);
  const reachable =
    result.computedScore === null
      ? null
      : Math.min(
          100,
          Math.round(
            result.computedScore + fixes.reduce((sum, f) => sum + f.gain, 0),
          ),
        );

  const stored = experiment.qualityScore?.summary;
  const summary =
    stored && stored.key === getQualitySummaryKey(result)
      ? stored.text
      : getQualitySummaryTemplate(result);
  const aiDate = experiment.aiQualityResults?.dateComputed
    ? date(experiment.aiQualityResults.dateComputed)
    : null;

  const submitOverride = async (body: {
    score: number | null;
    reason?: string;
  }) => {
    await apiCall(
      `/experiment-quality-score/experiment/${experiment.id}/override`,
      { method: "POST", body: JSON.stringify(body) },
    );
    mutate();
  };

  return (
    <Flex direction="column">
      {overrideModal ? (
        <OverrideScoreModal
          result={result}
          close={() => setOverrideModal(false)}
          submit={submitOverride}
        />
      ) : null}
      <Box px="5" pt="4" pb="4" position="relative">
        {canOverride ? (
          <Box position="absolute" top="3" right="4">
            <DropdownMenu
              trigger={<MoreMenuTrigger label="More actions" size="sm" />}
              menuPlacement="end"
            >
              <DropdownMenuItem onClick={() => setOverrideModal(true)}>
                {override ? "Edit override" : "Override score"}
              </DropdownMenuItem>
              {override ? (
                <DropdownMenuItem
                  onClick={() => submitOverride({ score: null })}
                >
                  Remove override
                </DropdownMenuItem>
              ) : null}
              {targets.recheckAI ? (
                <DropdownMenuItem onClick={targets.recheckAI}>
                  Re-run AI checks
                </DropdownMenuItem>
              ) : null}
            </DropdownMenu>
          </Box>
        ) : null}
        <Flex direction="column" align="center" gap="2">
          <QualityDonut
            score={score}
            ghostTo={fixesOpen && !override && !draft ? reachable : null}
          />
          {band ? (
            <Text weight="semibold" size="sm">
              <span style={{ color: band.text }}>{band.label}</span>
              {override ? (
                <span style={{ color: "var(--color-text-mid)" }}>
                  {" "}
                  · Overridden
                </span>
              ) : null}
            </Text>
          ) : null}
          <Box maxWidth="250px">
            <Text as="p" align="center" mb="0">
              {draft
                ? "Scored once the experiment starts. Fix these first."
                : summary}
            </Text>
          </Box>
        </Flex>
        <Flex direction="column" gap="2" mt="4">
          {override && result.computedScore !== null ? (
            <Disclosure
              open={overrideOpen}
              setOpen={setOverrideOpen}
              header={
                <>
                  <PiPencilSimple />
                  <Text>
                    Calculated <strong>{result.computedScore}</strong>
                    <span
                      style={{
                        color: getBandDisplay(result.computedScore).text,
                      }}
                    >
                      {" "}
                      · {getBandDisplay(result.computedScore).label}
                    </span>
                  </Text>
                </>
              }
            >
              <Box pl="5">
                <Text as="p" size="sm" color="text-mid" mb="1">
                  Overridden
                  {override.userName ? ` by ${override.userName}` : ""}
                  {override.dateOverridden
                    ? ` · ${date(override.dateOverridden)}`
                    : ""}
                </Text>
                {override.reason ? (
                  <Text as="p" size="sm" mb="0">
                    “{override.reason}”
                  </Text>
                ) : null}
              </Box>
            </Disclosure>
          ) : null}
          {fixes.length ? (
            <Disclosure
              open={fixesOpen}
              setOpen={setFixesOpen}
              header={
                <>
                  <PiTrendUp />
                  {draft ? (
                    <Text weight="semibold">
                      {fixes.length} {fixes.length === 1 ? "way" : "ways"} to
                      improve
                    </Text>
                  ) : (
                    <Text>
                      <strong>
                        {fixes.length} {fixes.length === 1 ? "fix" : "fixes"}
                      </strong>{" "}
                      to reach{" "}
                      <span
                        style={{
                          color: BAND_DISPLAY.strong.text,
                          fontWeight: 600,
                        }}
                      >
                        {reachable}
                      </span>
                    </Text>
                  )}
                </>
              }
            >
              <Flex direction="column" gap="2">
                {fixes.map((check) => {
                  const fix = getQualityFixAction(
                    check,
                    targets,
                    implementationId,
                  );
                  const content = (
                    <>
                      <span>{describeQualityFix(check)}</span>
                      {draft ? null : (
                        <span className={styles.gain}>
                          +{rounded(check.gain)}
                        </span>
                      )}
                    </>
                  );
                  return fix ? (
                    <button
                      key={check.key}
                      type="button"
                      className={styles.fix}
                      onClick={fix.onClick}
                    >
                      {content}
                    </button>
                  ) : (
                    <Flex key={check.key} justify="between" gap="3">
                      {content}
                    </Flex>
                  );
                })}
              </Flex>
            </Disclosure>
          ) : null}
        </Flex>
      </Box>
      {result.sections
        .filter((s) => s.enabled)
        .map((section) => (
          <SectionRow
            key={section.key}
            section={section}
            scored={!draft}
            targets={targets}
            implementationId={implementationId}
            aiDate={aiDate}
          />
        ))}
      <Box px="5" py="4" className={styles.section}>
        <Link href="/settings/experiment-quality">
          How the score is calculated
        </Link>
      </Box>
    </Flex>
  );
}
