import { ReactNode, ReactElement } from "react";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import isEqual from "lodash/isEqual";
import { Box, Flex } from "@radix-ui/themes";
import { PiArrowSquareOut } from "react-icons/pi";
import {
  FeatureRule,
  FeaturePrerequisite,
  SavedGroupTargeting,
  ExperimentRefVariation,
  FeatureInterface,
  FeatureEnvironment,
} from "shared/types/feature";
import { RevisionMetadata } from "shared/types/feature-revision";
import { toV2FeatureSnapshot } from "shared/util";
import { datetime } from "shared/dates";
import type {
  RevisionRampAction,
  RevisionRampCreateAction,
} from "shared/validators";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import SavedGroupTargetingDisplay from "@/components/Features/SavedGroupTargetingDisplay";
import ContextualBanditLink from "@/components/ContextualBandit/ContextualBanditLink";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Badge from "@/ui/Badge";
import { useExperiments } from "@/hooks/useExperiments";
import { useHoldouts, holdoutOccupiesRuleSlot } from "@/hooks/useHoldouts";
import { useEnvironments } from "@/services/features";
import Tooltip from "@/components/Tooltip/Tooltip";
import {
  ChangeField,
  toConditionString,
  GenericFieldChange,
  renderFallback,
  ProjectName,
  OwnerName,
} from "@/components/AuditHistoryExplorer/DiffRenderUtils";
import { COMPACT_DIFF_STYLES } from "@/components/AuditHistoryExplorer/CompareAuditEventsUtils";
import type { DiffBadge } from "@/components/AuditHistoryExplorer/types";
import SortedTags from "@/components/Tags/SortedTags";
import styles from "./FeatureDiffRenders.module.scss";

// Resolves an experiment ID to its display name and renders it as a link.
// Falls back to the raw ID if not found in the local SWR cache.
function ExperimentLink({
  experimentId,
}: {
  experimentId: string | undefined;
}) {
  const { experimentsMap } = useExperiments();
  if (!experimentId) return <em>unset</em>;
  const experiment = experimentsMap.get(experimentId);
  return (
    <Link href={`/experiment/${experimentId}`} target="_blank">
      {experiment?.name ?? experimentId}
      <PiArrowSquareOut style={{ marginLeft: 3, verticalAlign: "middle" }} />
    </Link>
  );
}

// Uses ChangeField for single-line values (booleans, numbers, short strings)
// and an inline ReactDiffViewer for multi-line / JSON values.
// When label is omitted the label row is suppressed (e.g. when the section
// card header already provides the heading).
function ValueChangedField({
  label,
  pre,
  post,
}: {
  label?: string;
  pre: string | null | undefined;
  post: string | null | undefined;
}) {
  if (isEqual(pre, post)) return null;
  // Treat null, undefined, and empty string as unset (matches GenericFieldChange precedent)
  const displayVal = (v: string | null | undefined): ReactNode =>
    v == null || v === "" ? <em>unset</em> : v;
  const isSimple = (v: string | null | undefined): boolean =>
    v == null || (!v.includes("\n") && v.length <= 80);
  if (isSimple(pre) && isSimple(post)) {
    if (label) {
      return (
        <ChangeField
          label={label}
          changed
          oldNode={displayVal(pre)}
          newNode={displayVal(post)}
        />
      );
    }
    return (
      <div className="d-flex align-items-start mb-2">
        <div className="text-danger d-flex align-items-start">
          <div className="text-center mr-2" style={{ width: 16 }}>
            Δ
          </div>
          <div>{displayVal(pre)}</div>
        </div>
        <div className="font-weight-bold text-success d-flex align-items-start ml-4">
          <div className="text-center mx-2" style={{ width: 16 }}>
            →
          </div>
          <div>{displayVal(post)}</div>
        </div>
      </div>
    );
  }
  // Multi-line content (e.g. pretty-printed JSON) — use inline diff viewer.
  // diff-wrapper applies theme-aware background/text (light/dark mode) from _bootstrap-theme-overrides.scss
  return (
    <div className="mb-2">
      {label && <div className="font-weight-bold mb-1">{label}</div>}
      <div
        className="diff-wrapper diff-wrapper-compact"
        style={{ maxHeight: 250, overflowY: "auto" }}
      >
        <ReactDiffViewer
          oldValue={pre ?? ""}
          newValue={post ?? ""}
          compareMethod={DiffMethod.LINES}
          styles={COMPACT_DIFF_STYLES}
        />
      </div>
    </div>
  );
}

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 1,
});

function getRuleTypeLabel(type: FeatureRule["type"]): string {
  switch (type) {
    case "force":
      return "Force";
    case "rollout":
      return "Rollout";
    case "experiment":
      return "Experiment";
    case "experiment-ref":
      return "Experiment ref";
    case "contextual-bandit-ref":
      return "Contextual Bandit ref";
    case "safe-rollout":
      return "Safe rollout";
  }
}

function formatValue(val: string | unknown): string {
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        return JSON.stringify(JSON.parse(trimmed), null, 2);
      } catch {
        // not valid JSON
      }
    }
    return val;
  }
  return JSON.stringify(val, null, 2);
}

// Text-only summary of a rule's env scope. Tri-state:
//   allEnvironments:true     → "All environments"
//   environments: [a, b, …]  → one chip per env
//   environments: []         → "No environments (pending)"
//   environments: undefined  → null (legacy audit fallback)
// Envs missing from the org list render in amber with strikethrough (orphaned).
function envScopeChip(envId: string) {
  return (
    <span
      key={envId}
      style={{
        fontSize: "var(--font-size-2)",
        fontWeight: 500,
      }}
    >
      {envId}
    </span>
  );
}

function envScopeOrphanedChip(envId: string) {
  return (
    <Tooltip
      key={`orphaned-${envId}`}
      body="Environment no longer exists"
      tipPosition="top"
      style={{ display: "inline-flex", alignItems: "center" }}
    >
      <span
        style={{
          color: "var(--amber-11)",
          fontSize: "var(--font-size-2)",
          textDecoration: "line-through",
        }}
      >
        {envId}
      </span>
    </Tooltip>
  );
}

function RuleEnvScope({ rule }: { rule: FeatureRule }) {
  const environments = useEnvironments();
  const liveEnvIds = new Set(environments.map((e) => e.id));
  if (rule.allEnvironments) {
    return (
      <span
        style={{
          fontSize: "var(--font-size-2)",
          fontWeight: 500,
        }}
      >
        All environments
      </span>
    );
  }
  if (rule.environments === undefined) return null;
  if (rule.environments.length === 0) {
    return (
      <Tooltip
        body="Rule is not scoped to any environment and will not apply anywhere"
        tipPosition="top"
        innerClassName="p-2"
        style={{ display: "inline-flex", alignItems: "center" }}
      >
        <span
          style={{
            color: "var(--amber-11)",
            fontSize: "var(--font-size-2)",
          }}
        >
          No environments (pending)
        </span>
      </Tooltip>
    );
  }
  return (
    <Flex gap="3" wrap="wrap" align="center">
      {rule.environments.map((env) =>
        liveEnvIds.has(env) ? envScopeChip(env) : envScopeOrphanedChip(env),
      )}
    </Flex>
  );
}

// ─── Ramp schedule diff helpers ──────────────────────────────────────────────
// Shared between the top-level "Create Ramp Schedule" diff card and per-rule
// pending-schedule blocks. A "simple schedule" has no steps — it just gates a
// rule on/off at scheduled date(s).

export function isSimpleRampAction(action: RevisionRampCreateAction): boolean {
  return action.steps.length === 0;
}

// Format a date as "Mon DD, YYYY at H:MM AM" — used in diff-summary bodies for
// simple schedules so reviewers see the time-of-day (the auto-generated
// schedule name in the title only carries date granularity).
export function fmtScheduleSummaryDateTime(
  d: string | Date | null | undefined,
): string | null {
  if (!d) return null;
  const parsed = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(parsed.getTime())) return null;
  const date = parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const time = parsed.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date} at ${time}`;
}

// Body text for the "enables {datetime} / disables {datetime}" portion of a
// simple-schedule diff card. Returns null if neither endpoint is set.
export function formatSimpleWindow(
  startDate: string | Date | null | undefined,
  endAt: string | Date | null | undefined,
): string | null {
  const start = fmtScheduleSummaryDateTime(startDate);
  const end = fmtScheduleSummaryDateTime(endAt);
  if (start && end) return `enables ${start}, disables ${end}`;
  if (start) return `enables ${start}`;
  if (end) return `disables ${end}`;
  return null;
}

export function RampScheduleSummary({
  startDate,
  endAt,
  stepCount,
}: {
  startDate?: string | Date | null;
  endAt?: string | Date | null;
  stepCount: number;
}) {
  const showStepRow = stepCount > 0;
  if (!startDate && !endAt && !showStepRow) return null;
  return (
    <Flex direction="column" gap="1">
      {startDate ? (
        <Text size="small">
          <strong>Enable:</strong> {datetime(startDate)}
        </Text>
      ) : null}
      {endAt ? (
        <Text size="small">
          <strong>Disable:</strong> {datetime(endAt)}
        </Text>
      ) : null}
      {showStepRow ? (
        <Text size="small">
          {stepCount} step{stepCount !== 1 ? "s" : ""}
        </Text>
      ) : null}
    </Flex>
  );
}

// Inline "pending publish" badge — used as the `titleSuffix` of standalone
// ramp diff cards and inline with the per-rule "Ramp schedule" label.
export function PendingPublishBadge() {
  return (
    <Badge
      label="pending publish"
      color="amber"
      variant="soft"
      radius="full"
      size="sm"
    />
  );
}

// Action label rendered next to a schedule/ramp diff title so reviewers can
// tell at a glance which lifecycle event the row represents (a draft create,
// a draft edit of an existing schedule, the activation of an existing pending
// schedule, or a pending detach).
type RampDiffAction = "create" | "update" | "activate" | "remove";

const RAMP_ACTION_STYLE: Record<
  RampDiffAction,
  { label: string; color: "amber" | "blue" | "green" | "red" }
> = {
  create: { label: "Create", color: "amber" },
  update: { label: "Update", color: "blue" },
  activate: { label: "Activate", color: "green" },
  remove: { label: "Remove", color: "red" },
};

export function RampActionLabel({ action }: { action: RampDiffAction }) {
  const { label, color } = RAMP_ACTION_STYLE[action];
  return (
    <Badge label={label} color={color} variant="soft" radius="full" size="sm" />
  );
}

// Shared body for ramp-schedule diff cards. The "pending publish" badge lives
// on the heading (`titleSuffix` standalone / inline label per-rule), so this
// body just renders the schedule summary + optional rule-target line.
function RampActionBody({
  action,
  // 1-based rule indices (matching `Rule #N`) for the "Target(s)" line.
  targetRuleIndices,
}: {
  action: RevisionRampCreateAction;
  targetRuleIndices?: number[];
}) {
  const endAt = action.cutoffDate ?? null;
  const ruleCount = targetRuleIndices?.length;
  return (
    <Flex direction="column" gap="2">
      <RampScheduleSummary
        startDate={action.startDate ?? undefined}
        endAt={endAt ?? undefined}
        stepCount={action.steps.length}
      />
      {ruleCount ? (
        <Text size="small" color="text-mid">
          {ruleCount === 1 ? "Target" : "Targets"}: {ruleCount} feature rule
          {ruleCount !== 1 ? "s" : ""} (
          {targetRuleIndices!.map((i) => `Rule #${i}`).join(", ")})
        </Text>
      ) : null}
    </Flex>
  );
}

// Per-rule pending-schedule block. Uses the same label style as other rule
// field rows so it slots in cleanly with the rest of the rule diff.
export function PendingRampForRule({
  action,
}: {
  action: RevisionRampCreateAction;
}) {
  const label = isSimpleRampAction(action) ? "Schedule" : "Ramp schedule";
  return (
    <div className="mb-2">
      <Flex align="center" gap="2" mb="1" wrap="wrap">
        <Text size="medium" weight="medium" color="text-mid">
          {label}
        </Text>
        <PendingPublishBadge />
      </Flex>
      <RampActionBody action={action} />
    </div>
  );
}

// Top-level "Create (Ramp) Schedule" diff card body. The pending-publish
// badge is supplied via `titleSuffix` so it sits inline with the heading
// (matching the per-rule layout).
export function CreatedRampScheduleBody({
  action,
  targetRuleIndices,
}: {
  action: RevisionRampCreateAction;
  targetRuleIndices?: number[];
}) {
  return (
    <RampActionBody action={action} targetRuleIndices={targetRuleIndices} />
  );
}

export function findPendingRampForRule(
  ruleId: string,
  pendingRampActions: RevisionRampAction[] | undefined,
): RevisionRampCreateAction | undefined {
  return pendingRampActions?.find(
    (a): a is RevisionRampCreateAction =>
      a.mode === "create" && a.ruleId === ruleId,
  );
}

// "Rule #3 — Force (value: xyz)" compact descriptor used as a sub-heading.
// Env scope is rendered inline since rule diffs aren't bucketed by env.
function RuleHeading({ rule, index }: { rule: FeatureRule; index: number }) {
  let detail: ReactNode = "";
  if (rule.type === "force") {
    // rule.value may be a parsed object after normalizeSnapshot, not a raw string
    const valStr =
      typeof rule.value === "string" ? rule.value : JSON.stringify(rule.value);
    const v = valStr.slice(0, 40);
    detail = `value: ${v}${valStr.length > 40 ? "…" : ""}`;
  } else if (rule.type === "rollout") {
    detail = `${percentFormatter.format(rule.coverage)} of ${rule.hashAttribute}${rule.seed ? `, seed: ${rule.seed}` : ""}`;
  } else if (rule.type === "experiment") {
    detail = `key: ${rule.trackingKey}`;
  } else if (rule.type === "experiment-ref") {
    detail = <ExperimentLink experimentId={rule.experimentId} />;
  } else if (rule.type === "contextual-bandit-ref") {
    detail = (
      <ContextualBanditLink contextualBanditId={rule.contextualBanditId} />
    );
  }
  return (
    <div className="mb-2">
      <Flex align="center" gap="2" wrap="wrap">
        <Text size="medium" weight="semibold" color="text-high">
          Rule #{index} — {getRuleTypeLabel(rule.type)}
        </Text>
        <RuleEnvScope rule={rule} />
      </Flex>
      {(detail || rule.description) && (
        <Text size="small" color="text-low" as="span">
          {detail ? <> ({detail})</> : null}
          {rule.description ? ` · ${rule.description}` : ""}
        </Text>
      )}
    </div>
  );
}

function RuleFieldDiffs({
  pre,
  post,
  pendingRampAction,
}: {
  pre: FeatureRule;
  post: FeatureRule;
  pendingRampAction?: RevisionRampCreateAction;
}) {
  if (isEqual(pre, post) && !pendingRampAction) return null;

  const rows: ReactNode[] = [];
  // id/type/scheduleRules are structural; allEnvironments+environments render
  // together as a single "Environments" row below. The rest are explicit cases.
  const handled = new Set<string>([
    "id",
    "type",
    "condition",
    "savedGroups",
    "prerequisites",
    "enabled",
    "scheduleRules",
    "value",
    "coverage",
    "experimentId",
    "variations",
    "controlValue",
    "variationValue",
    "allEnvironments",
    "environments",
  ]);

  const sortedEnvs = (r: FeatureRule): string[] =>
    Array.isArray(r.environments) ? [...r.environments].sort() : [];
  const envScopeChanged =
    !!pre.allEnvironments !== !!post.allEnvironments ||
    !isEqual(sortedEnvs(pre), sortedEnvs(post));
  if (envScopeChanged) {
    const renderScope = (r: FeatureRule): ReactNode =>
      r.allEnvironments || Array.isArray(r.environments) ? (
        <RuleEnvScope rule={r} />
      ) : (
        <em>unset</em>
      );
    rows.push(
      <ChangeField
        key="envScope"
        label="Environments"
        changed
        oldNode={renderScope(pre)}
        newNode={renderScope(post)}
      />,
    );
  }

  if (!isEqual(pre.enabled, post.enabled)) {
    rows.push(
      <ChangeField
        key="enabled"
        label="Enabled"
        changed
        oldNode={pre.enabled === false ? "disabled" : "enabled"}
        newNode={post.enabled === false ? "disabled" : "enabled"}
      />,
    );
  }

  const preCond = toConditionString((pre as { condition?: unknown }).condition);
  const postCond = toConditionString(
    (post as { condition?: unknown }).condition,
  );
  if (!isEqual(preCond, postCond)) {
    rows.push(
      <ChangeField
        key="cond"
        label="Targeting condition"
        changed
        oldNode={
          preCond && preCond !== "{}" ? (
            <ConditionDisplay condition={preCond} />
          ) : (
            <em>unset</em>
          )
        }
        newNode={
          postCond && postCond !== "{}" ? (
            <ConditionDisplay condition={postCond} />
          ) : (
            <em>unset</em>
          )
        }
      />,
    );
  }

  const preSG = (pre as { savedGroups?: SavedGroupTargeting[] }).savedGroups;
  const postSG = (post as { savedGroups?: SavedGroupTargeting[] }).savedGroups;
  if (!isEqual(preSG, postSG)) {
    rows.push(
      <ChangeField
        key="sg"
        label="Saved group targeting"
        changed
        oldNode={
          preSG?.length ? (
            <SavedGroupTargetingDisplay savedGroups={preSG} />
          ) : (
            <em>unset</em>
          )
        }
        newNode={
          postSG?.length ? (
            <SavedGroupTargetingDisplay savedGroups={postSG} />
          ) : (
            <em>unset</em>
          )
        }
      />,
    );
  }

  const prePrereqs = (pre as { prerequisites?: FeaturePrerequisite[] })
    .prerequisites;
  const postPrereqs = (post as { prerequisites?: FeaturePrerequisite[] })
    .prerequisites;
  if (!isEqual(prePrereqs, postPrereqs)) {
    const normPrereqs = (
      arr: FeaturePrerequisite[] | undefined,
    ): FeaturePrerequisite[] | undefined =>
      arr?.length
        ? arr.map((p) => ({
            id: p.id,
            condition: toConditionString(p.condition) ?? "{}",
          }))
        : undefined;
    rows.push(
      <ChangeField
        key="prereq"
        label="Prerequisites"
        changed
        oldNode={
          normPrereqs(prePrereqs)?.length ? (
            <ConditionDisplay prerequisites={normPrereqs(prePrereqs)} />
          ) : (
            <em>unset</em>
          )
        }
        newNode={
          normPrereqs(postPrereqs)?.length ? (
            <ConditionDisplay prerequisites={normPrereqs(postPrereqs)} />
          ) : (
            <em>unset</em>
          )
        }
      />,
    );
  }

  if (
    "value" in pre &&
    "value" in post &&
    !isEqual(
      (pre as { value: string }).value,
      (post as { value: string }).value,
    )
  ) {
    rows.push(
      <ValueChangedField
        key="value"
        label="Value"
        pre={formatValue((pre as { value: string }).value)}
        post={formatValue((post as { value: string }).value)}
      />,
    );
  }

  if (
    "controlValue" in pre &&
    "controlValue" in post &&
    !isEqual(
      (pre as { controlValue: string }).controlValue,
      (post as { controlValue: string }).controlValue,
    )
  ) {
    rows.push(
      <ValueChangedField
        key="controlValue"
        label="Control value"
        pre={formatValue((pre as { controlValue: string }).controlValue)}
        post={formatValue((post as { controlValue: string }).controlValue)}
      />,
    );
  }
  if (
    "variationValue" in pre &&
    "variationValue" in post &&
    !isEqual(
      (pre as { variationValue: string }).variationValue,
      (post as { variationValue: string }).variationValue,
    )
  ) {
    rows.push(
      <ValueChangedField
        key="variationValue"
        label="Variation value"
        pre={formatValue((pre as { variationValue: string }).variationValue)}
        post={formatValue((post as { variationValue: string }).variationValue)}
      />,
    );
  }

  if (
    "coverage" in pre &&
    "coverage" in post &&
    !isEqual(
      (pre as { coverage: number }).coverage,
      (post as { coverage: number }).coverage,
    )
  ) {
    rows.push(
      <ChangeField
        key="coverage"
        label="Coverage"
        changed
        oldNode={percentFormatter.format(
          (pre as { coverage: number }).coverage,
        )}
        newNode={percentFormatter.format(
          (post as { coverage: number }).coverage,
        )}
      />,
    );
  }

  if (
    "experimentId" in post &&
    !isEqual(
      (pre as { experimentId?: string }).experimentId,
      (post as { experimentId: string }).experimentId,
    )
  ) {
    rows.push(
      <ChangeField
        key="experimentId"
        label="Experiment"
        changed
        oldNode={
          <ExperimentLink
            experimentId={(pre as { experimentId?: string }).experimentId}
          />
        }
        newNode={
          <ExperimentLink
            experimentId={(post as { experimentId: string }).experimentId}
          />
        }
      />,
    );
  }

  if ("variations" in post) {
    const preVars =
      (pre as { variations?: ExperimentRefVariation[] }).variations ?? [];
    const postVars = (post as { variations: ExperimentRefVariation[] })
      .variations;
    // match by index; variationId is stable across edits
    const maxLen = Math.max(preVars.length, postVars.length);
    for (let i = 0; i < maxLen; i++) {
      const pv = preVars[i];
      const nv = postVars[i];
      if (isEqual(pv?.value, nv?.value)) continue;
      rows.push(
        <ValueChangedField
          key={`var-${i}`}
          label={`Variation ${i} value`}
          pre={pv !== null && pv !== undefined ? formatValue(pv.value) : null}
          post={nv !== null && nv !== undefined ? formatValue(nv.value) : null}
        />,
      );
    }
  }

  const preRec = pre as Record<string, unknown>;
  const postRec = post as Record<string, unknown>;
  const fallbackKeys = Object.keys(postRec).filter(
    (k) =>
      !handled.has(k) &&
      !isEqual(preRec[k], postRec[k]) &&
      postRec[k] !== undefined,
  );
  for (const k of fallbackKeys) {
    rows.push(
      <GenericFieldChange
        key={k}
        fieldKey={k}
        preVal={preRec[k]}
        postVal={postRec[k]}
      />,
    );
  }

  if (pendingRampAction) {
    rows.push(
      <PendingRampForRule key="pendingRamp" action={pendingRampAction} />,
    );
  }

  if (!rows.length) return null;
  return <div className="mt-1 ml-3">{rows}</div>;
}

function NewRuleDetails({
  rule,
  pendingRampAction,
}: {
  rule: FeatureRule;
  pendingRampAction?: RevisionRampCreateAction;
}) {
  const rows: ReactNode[] = [];

  // Combined env-scope row (matches `RuleFieldDiffs`); raw fields are
  // suppressed via the `handled` set below.
  if (rule.allEnvironments || Array.isArray(rule.environments)) {
    rows.push(
      <ChangeField
        key="envScope"
        label="Environments"
        changed
        oldNode={<em>unset</em>}
        newNode={<RuleEnvScope rule={rule} />}
      />,
    );
  }

  const cond = toConditionString((rule as { condition?: unknown }).condition);
  const sg = (rule as { savedGroups?: SavedGroupTargeting[] }).savedGroups;
  const prereqs = (rule as { prerequisites?: FeaturePrerequisite[] })
    .prerequisites;

  if (cond && cond !== "{}") {
    rows.push(
      <ChangeField
        key="cond"
        label="Targeting condition"
        changed
        oldNode={<em>unset</em>}
        newNode={<ConditionDisplay condition={cond} />}
      />,
    );
  }

  if (sg?.length) {
    rows.push(
      <ChangeField
        key="sg"
        label="Saved group targeting"
        changed
        oldNode={<em>unset</em>}
        newNode={<SavedGroupTargetingDisplay savedGroups={sg} />}
      />,
    );
  }

  if (prereqs?.length) {
    const normPrereqs = prereqs.map((p) => ({
      id: p.id,
      condition: toConditionString(p.condition) ?? "{}",
    }));
    rows.push(
      <ChangeField
        key="prereq"
        label="Prerequisites"
        changed
        oldNode={<em>unset</em>}
        newNode={<ConditionDisplay prerequisites={normPrereqs} />}
      />,
    );
  }

  if (rule.type === "force") {
    rows.push(
      <ValueChangedField
        key="value"
        label="Value"
        pre={null}
        post={formatValue(rule.value)}
      />,
    );
  }

  if (rule.type === "rollout") {
    rows.push(
      <ChangeField
        key="coverage"
        label="Coverage"
        changed
        oldNode={<em>unset</em>}
        newNode={percentFormatter.format(rule.coverage)}
      />,
      <ValueChangedField
        key="value"
        label="Value"
        pre={null}
        post={formatValue(rule.value)}
      />,
    );
  }

  if (rule.type === "safe-rollout") {
    rows.push(
      <ValueChangedField
        key="controlValue"
        label="Control value"
        pre={null}
        post={formatValue(rule.controlValue)}
      />,
      <ValueChangedField
        key="variationValue"
        label="Variation value"
        pre={null}
        post={formatValue(rule.variationValue)}
      />,
    );
  }

  if (rule.type === "contextual-bandit-ref") {
    rows.push(
      <ChangeField
        key="contextualBanditId"
        label="Contextual Bandit"
        changed
        oldNode={<em>unset</em>}
        newNode={
          <ContextualBanditLink contextualBanditId={rule.contextualBanditId} />
        }
      />,
    );
    rule.variations.forEach((v, i) => {
      rows.push(
        <ValueChangedField
          key={`cb-var-${i}`}
          label={`Variation ${i} value`}
          pre={null}
          post={formatValue(v.value)}
        />,
      );
    });
  }

  if (rule.type === "experiment-ref") {
    rows.push(
      <ChangeField
        key="experimentId"
        label="Experiment"
        changed
        oldNode={<em>unset</em>}
        newNode={<ExperimentLink experimentId={rule.experimentId} />}
      />,
    );
    rule.variations.forEach((v, i) => {
      rows.push(
        <ValueChangedField
          key={`var-${i}`}
          label={`Variation ${i} value`}
          pre={null}
          post={formatValue(v.value)}
        />,
      );
    });
  }

  if (rule.enabled === false) {
    rows.push(
      <ChangeField
        key="enabled"
        label="Enabled"
        changed
        oldNode={<em>unset</em>}
        newNode="disabled"
      />,
    );
  }

  // id/type/scheduleRules are structural; everything else is rendered
  // explicitly above (env scope as a combined row).
  const handled = new Set([
    "id",
    "type",
    "scheduleRules",
    "condition",
    "savedGroups",
    "prerequisites",
    "enabled",
    "value",
    "coverage",
    "controlValue",
    "variationValue",
    "experimentId",
    "variations",
    "allEnvironments",
    "environments",
  ]);
  rows.push(
    ...renderFallback(
      null,
      rule as unknown as Record<string, unknown>,
      handled,
    ),
  );

  if (pendingRampAction) {
    rows.push(
      <PendingRampForRule key="pendingRamp" action={pendingRampAction} />,
    );
  }

  if (!rows.length) return <></>;
  return <div className="ml-3">{rows}</div>;
}

// Label omitted — revision/draft summary cards already use the section title "Default value".
export function renderFeatureDefaultValue(
  pre: string | null | undefined,
  post: string,
): ReactNode | null {
  if (pre === post) return null;
  const preFormatted =
    pre !== null && pre !== undefined ? formatValue(pre) : null;
  const postFormatted = formatValue(post);
  return <ValueChangedField pre={preFormatted} post={postFormatted} />;
}

export type RuleChangeSummary = {
  added: FeatureRule[];
  removed: FeatureRule[];
  // same id, changed content
  modified: FeatureRule[];
  // same content, different order
  reordered: boolean;
};

export function analyzeRuleChanges(
  preRules: FeatureRule[],
  postRules: FeatureRule[],
): RuleChangeSummary {
  const preById = new Map(preRules.map((r) => [r.id, r]));
  const postById = new Map(postRules.map((r) => [r.id, r]));

  const added = postRules.filter((r) => !preById.has(r.id));
  const removed = preRules.filter((r) => !postById.has(r.id));
  const modified = postRules.filter((r) => {
    const prev = preById.get(r.id);
    return prev !== undefined && !isEqual(prev, r);
  });
  // Detect reordering independently of adds/removes/modifications:
  // compare the relative order of rules that exist in both pre and post (unchanged).
  const commonPreIds = preRules
    .filter((r) => postById.has(r.id))
    .map((r) => r.id);
  const commonPostIds = postRules
    .filter((r) => preById.has(r.id))
    .map((r) => r.id);
  const reordered = !isEqual(commonPreIds, commonPostIds);

  return { added, removed, modified, reordered };
}

export function logBadgeColor(
  action: string,
): "green" | "red" | "amber" | "gray" {
  if (action === "Approved") return "green";
  if (action === "Requested Changes") return "red";
  if (action === "Review Requested") return "amber";

  // Handle common diff actions
  const lowerAction = action.toLowerCase();
  if (lowerAction.includes("add") || lowerAction.includes("enable"))
    return "green";
  if (
    lowerAction.includes("delete") ||
    lowerAction.includes("remove") ||
    lowerAction.includes("disable")
  )
    return "red";
  if (
    lowerAction.includes("edit") ||
    lowerAction.includes("change") ||
    lowerAction.includes("update") ||
    lowerAction.includes("reorder")
  )
    return "amber";

  return "gray";
}

// Env-agnostic summary badges for rule changes — each rule's scope is rendered
// inline via `RuleEnvScope` in the diff card heading.
export function featureRuleChangeBadges(
  preRules: FeatureRule[],
  postRules: FeatureRule[],
): DiffBadge[] {
  const { added, removed, modified, reordered } = analyzeRuleChanges(
    preRules,
    postRules,
  );
  const badges: DiffBadge[] = [];
  if (added.length)
    badges.push({
      label: `Add rule${added.length > 1 ? ` ×${added.length}` : ""}`,
      action: "add rule",
    });
  if (removed.length)
    badges.push({
      label: `Delete rule${removed.length > 1 ? ` ×${removed.length}` : ""}`,
      action: "delete rule",
    });
  if (modified.length)
    badges.push({
      label: `Edit rule${modified.length > 1 ? ` ×${modified.length}` : ""}`,
      action: "edit rule",
    });
  if (reordered)
    badges.push({
      label: "Reorder rules",
      action: "reorder rules",
    });
  return badges;
}

export function renderFeatureRules(
  preRules: FeatureRule[],
  postRules: FeatureRule[],
  options?: {
    pendingRampActions?: RevisionRampAction[];
    // Holdout occupies rule slot #1 (matches Rule.tsx); regular rules then
    // start at #2. Tracked per side so a holdout add/remove still renders
    // each side with its own correct numbering.
    preHasHoldout?: boolean;
    postHasHoldout?: boolean;
  },
): ReactNode | null {
  const { added, removed, modified, reordered } = analyzeRuleChanges(
    preRules,
    postRules,
  );

  const postOffset = options?.postHasHoldout ? 2 : 1;
  const preOffset = options?.preHasHoldout ? 2 : 1;
  const postIndexById = new Map(
    postRules.map((r, i) => [r.id, i + postOffset]),
  );
  const preIndexById = new Map(preRules.map((r, i) => [r.id, i + preOffset]));
  const preById = new Map(preRules.map((r) => [r.id, r]));
  const pendingRampActions = options?.pendingRampActions;

  // Rules that aren't add/modify/reorder but do have a pending ramp action —
  // surface them as a "modified" entry so the user sees the per-rule pending
  // schedule summary even when the rule's other fields are unchanged.
  const addedIds = new Set(added.map((r) => r.id));
  const modifiedIds = new Set(modified.map((r) => r.id));
  const rampOnlyTouched: FeatureRule[] = pendingRampActions
    ? postRules.filter((r) => {
        if (addedIds.has(r.id) || modifiedIds.has(r.id)) return false;
        return !!findPendingRampForRule(r.id, pendingRampActions);
      })
    : [];

  if (
    !added.length &&
    !removed.length &&
    !modified.length &&
    !reordered &&
    !rampOnlyTouched.length
  )
    return null;

  const sections: ReactNode[] = [];

  if (reordered) {
    const movedRules = postRules
      .map((r, newIdx) => ({
        r,
        newPos: newIdx + postOffset,
        oldPos: preIndexById.get(r.id),
      }))
      .filter(
        ({ oldPos, newPos }) => oldPos !== undefined && oldPos !== newPos,
      );
    if (movedRules.length > 0) {
      sections.push(
        <div key="reordered" className="mb-3">
          <Text size="medium" weight="medium" color="text-mid" as="div" mb="2">
            Reordered
          </Text>
          {movedRules.map(({ r, newPos, oldPos }) => (
            <Box key={r.id} mb="2" className={styles.ruleSummaryBox}>
              <Flex align="start" justify="between" gap="2">
                <div style={{ flex: 1 }}>
                  <RuleHeading rule={r} index={newPos} />
                </div>
                <Badge label={`was #${oldPos}`} color="amber" variant="soft" />
              </Flex>
            </Box>
          ))}
        </div>,
      );
    }
  }

  if (added.length > 0) {
    sections.push(
      <div key="added" className="mb-3">
        <Text size="medium" weight="medium" color="text-mid" as="div" mb="2">
          Added
        </Text>
        {added.map((r) => {
          const idx = postIndexById.get(r.id)!;
          return (
            <Box key={r.id} mb="3" className={styles.ruleSummaryBox}>
              <RuleHeading rule={r} index={idx} />
              <NewRuleDetails
                rule={r}
                pendingRampAction={findPendingRampForRule(
                  r.id,
                  pendingRampActions,
                )}
              />
            </Box>
          );
        })}
      </div>,
    );
  }

  if (removed.length > 0) {
    sections.push(
      <div key="removed" className="mb-3">
        <Text size="medium" weight="medium" color="text-mid" as="div" mb="2">
          Removed
        </Text>
        {removed.map((r) => {
          const idx = preIndexById.get(r.id)!;
          return (
            <Box key={r.id} mb="2" className={styles.ruleSummaryBox}>
              <RuleHeading rule={r} index={idx} />
            </Box>
          );
        })}
      </div>,
    );
  }

  // Combine "true" content modifications with rules touched only by a pending
  // ramp action so the user sees a "Pending Ramp Schedule" summary on
  // unchanged rules whose schedule is being created in this draft.
  const modifiedAll = [...modified, ...rampOnlyTouched];
  if (modifiedAll.length > 0) {
    sections.push(
      <div key="modified" className="mb-2">
        <Text size="medium" weight="medium" color="text-mid" as="div" mb="2">
          Modified
        </Text>
        {modifiedAll.map((r) => {
          const prev = preById.get(r.id)!;
          const idx = postIndexById.get(r.id)!;
          return (
            <Box key={r.id} mb="3" className={styles.ruleSummaryBox}>
              <RuleHeading rule={r} index={idx} />
              <RuleFieldDiffs
                pre={prev ?? r}
                post={r}
                pendingRampAction={findPendingRampForRule(
                  r.id,
                  pendingRampActions,
                )}
              />
            </Box>
          );
        })}
      </div>,
    );
  }

  return sections.length ? <div className="mt-1">{sections}</div> : null;
}

// Parses embedded JSON objects/arrays from a string. Leaves primitives as-is.
function parseEmbeddedJson(str: string): unknown {
  const trimmed = str.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // not valid JSON
    }
  }
  return str;
}

// Parses JSON strings in rule fields so the diff viewer shows structured JSON.
// Used by both the revision hook and the audit snapshot normalizer.
export function normalizeFeatureRules(rules: FeatureRule[]): FeatureRule[] {
  if (!Array.isArray(rules)) return rules;
  return rules.map((rule) => {
    const r = { ...rule } as Record<string, unknown>;
    for (const k of ["condition", "value", "controlValue", "variationValue"]) {
      if (typeof r[k] === "string") r[k] = parseEmbeddedJson(r[k] as string);
    }
    if (Array.isArray(r.variations)) {
      r.variations = (r.variations as Array<Record<string, unknown>>).map(
        (v) => ({
          ...v,
          value:
            typeof v.value === "string" ? parseEmbeddedJson(v.value) : v.value,
        }),
      );
    }
    return r as unknown as FeatureRule;
  });
}

const FEATURE_JSON_KEYS = new Set([
  "condition",
  "defaultValue",
  "value",
  "controlValue",
  "variationValue",
]);

// Audit-diff snapshot normalizer: parses embedded JSON strings and migrates
// pre-v2 snapshots (rules under `environmentSettings[env].rules`) to the flat
// `feature.rules` shape so historical audit logs render with current renderers.
export function normalizeFeatureSnapshot(
  snapshot: FeatureInterface,
): FeatureInterface {
  snapshot = toV2FeatureSnapshot(snapshot);
  function walk(obj: unknown): unknown {
    if (Array.isArray(obj)) return obj.map(walk);
    if (obj !== null && typeof obj === "object") {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (FEATURE_JSON_KEYS.has(k) && typeof v === "string") {
          try {
            result[k] = JSON.parse(v);
          } catch {
            result[k] = v;
          }
        } else {
          result[k] = walk(v);
        }
      }
      return result;
    }
    return obj;
  }
  return walk(snapshot) as FeatureInterface;
}

// AuditDiffSection adapters — bridge Partial<FeatureInterface> to the renderers above.

type FeaturePartial = Partial<FeatureInterface> | null;

// defaultValue may already be a parsed object after normalizeSnapshot, so
// re-stringify. Label is omitted (section card header already says "Default value").
export function renderFeatureDefaultValueSection(
  pre: FeaturePartial,
  post: Partial<FeatureInterface>,
): ReactNode | null {
  const toStr = (v: unknown): string | null =>
    v == null ? null : typeof v === "string" ? v : JSON.stringify(v);
  const preStr = (toStr(pre?.defaultValue) ?? "").trim();
  const postStr = (toStr(post.defaultValue) ?? "").trim();
  if (preStr === postStr) return null;
  return (
    <ValueChangedField
      pre={preStr ? formatValue(preStr) : null}
      post={formatValue(postStr)}
    />
  );
}

// Rules section: per-env enable-toggle rows + a single rules diff off the
// flat `feature.rules` array. Each rule card carries its env scope inline.
function FeatureRulesSection({
  pre,
  post,
}: {
  pre: FeaturePartial;
  post: Partial<FeatureInterface>;
}): ReactElement | null {
  const { holdoutsMap } = useHoldouts();

  const preEnvs = (pre?.environmentSettings ?? {}) as Record<
    string,
    FeatureEnvironment
  >;
  const postEnvs = (post.environmentSettings ?? {}) as Record<
    string,
    FeatureEnvironment
  >;
  const envsInSettings = new Set([
    ...Object.keys(preEnvs),
    ...Object.keys(postEnvs),
  ]);

  const toggleRows: ReactNode[] = [];
  for (const env of envsInSettings) {
    const preEnabled = preEnvs[env]?.enabled;
    const postEnabled = postEnvs[env]?.enabled;
    if (
      preEnabled !== undefined &&
      postEnabled !== undefined &&
      preEnabled !== postEnabled
    ) {
      toggleRows.push(
        <ChangeField
          key={`toggle-${env}`}
          label={`${env} enabled`}
          changed
          oldNode={preEnabled ? "enabled" : "disabled"}
          newNode={postEnabled ? "enabled" : "disabled"}
        />,
      );
    }
  }

  const preRules = Array.isArray(pre?.rules) ? (pre?.rules ?? []) : [];
  const postRules = Array.isArray(post.rules) ? (post.rules ?? []) : [];
  const rulesChanged = !isEqual(preRules, postRules);
  const rulesRender = rulesChanged
    ? renderFeatureRules(preRules, postRules, {
        // Match Rule.tsx numbering: the holdout occupies slot #1 only when
        // it's actually enabled in some env (see `liveHoldoutActiveAnyEnv`
        // in FeatureRules.tsx).
        preHasHoldout: holdoutOccupiesRuleSlot(pre?.holdout, holdoutsMap),
        postHasHoldout: holdoutOccupiesRuleSlot(post.holdout, holdoutsMap),
      })
    : null;

  if (toggleRows.length === 0 && !rulesRender) return null;

  return (
    <>
      {toggleRows.length > 0 && (
        <div className="mb-2">
          <Heading as="h6" size="small" color="text-mid" mb="2">
            Environment toggles
          </Heading>
          {toggleRows}
        </div>
      )}
      {rulesRender && (
        <div className={toggleRows.length > 0 ? "mt-3" : ""}>
          <Heading as="h6" size="small" color="text-mid" mb="2">
            Rules
          </Heading>
          {rulesRender}
        </div>
      )}
    </>
  );
}

// `renderFeatureRulesSection` is invoked as an `AuditDiffSection.render`
// callback; wrap the component so call sites stay function-shaped.
export function renderFeatureRulesSection(
  pre: FeaturePartial,
  post: Partial<FeatureInterface>,
): ReactNode | null {
  return <FeatureRulesSection pre={pre} post={post} />;
}

// True when the archived flag meaningfully changed. Treats `undefined` as
// `false` so legacy audit events (archived field absent) don't register as a
// change. Shared by the render and badge paths so they can never drift.
export function featureArchivedChanged(
  pre: boolean | undefined,
  post: boolean | undefined,
): boolean {
  return post !== undefined && (pre ?? false) !== (post ?? false);
}

// Renders a single "active → archived" change row. Shared by the audit-history
// Settings section and the draft/review "Archive status" diff so both views
// represent an archive change identically. Returns null when unchanged.
export function renderFeatureArchived(
  pre: boolean | undefined,
  post: boolean | undefined,
): ReactElement | null {
  if (!featureArchivedChanged(pre, post)) return null;
  return (
    <ChangeField
      key="archived"
      label="Archived"
      changed
      oldNode={(pre ?? false) ? "archived" : "active"}
      newNode={post ? "archived" : "active"}
    />
  );
}

// Targeting-projects change detection + rendering, shared by every metadata
// diff surface (revision compare, audit-event compare) so the two projections
// stay identical. `targetingAllProjects` overrides the explicit list.
export function targetingProjectsChanged(
  preAll: boolean | undefined,
  preProjects: string[] | undefined,
  postAll: boolean | undefined,
  postProjects: string[] | undefined,
): boolean {
  return (
    (preAll ?? false) !== (postAll ?? false) ||
    !isEqual(preProjects ?? [], postProjects ?? [])
  );
}

function renderTargetingNode(
  allProjects: boolean | undefined,
  projects: string[] | undefined,
): ReactNode {
  if (allProjects) return "All projects";
  if (!projects?.length) return <em>none</em>;
  return (
    <>
      {projects.map((p, i) => (
        <span key={p}>
          {i > 0 ? ", " : ""}
          <ProjectName id={p} />
        </span>
      ))}
    </>
  );
}

export function renderFeatureMetadataSection(
  pre: FeaturePartial,
  post: Partial<FeatureInterface>,
): ReactNode | null {
  const rows: ReactNode[] = [];

  const archivedRow = renderFeatureArchived(pre?.archived, post.archived);
  if (archivedRow) {
    rows.push(archivedRow);
  }

  if ((pre?.owner || "") !== (post.owner || "") && post.owner !== undefined) {
    rows.push(
      <ChangeField
        key="owner"
        label="Owner"
        changed
        oldNode={pre?.owner || <em>unset</em>}
        newNode={post.owner}
      />,
    );
  }

  if (
    (pre?.project || "") !== (post.project || "") &&
    post.project !== undefined
  ) {
    rows.push(
      <ChangeField
        key="project"
        label="Project"
        changed
        oldNode={
          pre?.project ? <ProjectName id={pre.project} /> : <em>unset</em>
        }
        newNode={<ProjectName id={post.project} />}
      />,
    );
  }

  if (
    (post.targetingAllProjects !== undefined ||
      post.targetingProjects !== undefined) &&
    targetingProjectsChanged(
      pre?.targetingAllProjects,
      pre?.targetingProjects,
      post.targetingAllProjects,
      post.targetingProjects,
    )
  ) {
    rows.push(
      <ChangeField
        key="targeting"
        label="Targeting projects"
        changed
        oldNode={renderTargetingNode(
          pre?.targetingAllProjects,
          pre?.targetingProjects,
        )}
        newNode={renderTargetingNode(
          post.targetingAllProjects,
          post.targetingProjects,
        )}
      />,
    );
  }

  if (!isEqual(pre?.tags, post.tags) && post.tags !== undefined) {
    const preTags = pre?.tags ?? [];
    const postTags = post.tags ?? [];
    const added = postTags.filter((t) => !preTags.includes(t));
    const removed = preTags.filter((t) => !postTags.includes(t));
    if (added.length || removed.length) {
      rows.push(
        <div key="tags" className="mb-2">
          <div className="mb-1">
            <Text size="medium" weight="medium" color="text-mid">
              Tags
            </Text>
          </div>
          <div className="d-flex flex-wrap" style={{ gap: 4 }}>
            {removed.map((t) => (
              <Badge key={t} label={`− ${t}`} color="red" variant="soft" />
            ))}
            {added.map((t) => (
              <Badge key={t} label={`+ ${t}`} color="green" variant="soft" />
            ))}
          </div>
        </div>,
      );
    }
  }

  if (
    !isEqual(pre?.description, post.description) &&
    post.description !== undefined &&
    (pre?.description || "") !== (post.description || "")
  ) {
    rows.push(
      <ValueChangedField
        key="description"
        label="Description"
        pre={pre?.description || null}
        post={post.description || null}
      />,
    );
  }

  if (!rows.length) return null;
  return <div>{rows}</div>;
}

export function getFeatureMetadataBadges(
  pre: FeaturePartial,
  post: Partial<FeatureInterface>,
): DiffBadge[] {
  const badges: DiffBadge[] = [];
  if (featureArchivedChanged(pre?.archived, post.archived)) {
    badges.push({
      label: post.archived ? "Archived" : "Unarchived",
      action: "archive",
    });
  }
  if ((pre?.owner || "") !== (post.owner || "") && post.owner !== undefined) {
    badges.push({ label: "Edit owner", action: "edit owner" });
  }
  if (
    (pre?.project || "") !== (post.project || "") &&
    post.project !== undefined
  ) {
    badges.push({ label: "Edit project", action: "edit project" });
  }
  if (
    (post.targetingAllProjects !== undefined ||
      post.targetingProjects !== undefined) &&
    targetingProjectsChanged(
      pre?.targetingAllProjects,
      pre?.targetingProjects,
      post.targetingAllProjects,
      post.targetingProjects,
    )
  ) {
    badges.push({
      label: "Edit targeting projects",
      action: "edit targeting",
    });
  }
  if (!isEqual(pre?.tags, post.tags) && post.tags !== undefined) {
    const preTags = pre?.tags ?? [];
    const postTags = post.tags ?? [];
    if (
      postTags.some((t) => !preTags.includes(t)) ||
      preTags.some((t) => !postTags.includes(t))
    ) {
      badges.push({ label: "Edit tags", action: "edit tags" });
    }
  }
  if (
    (pre?.description || "") !== (post.description || "") &&
    post.description !== undefined
  ) {
    badges.push({ label: "Edit description", action: "edit description" });
  }
  return badges;
}

export function getFeatureRulesBadges(
  pre: FeaturePartial,
  post: Partial<FeatureInterface>,
): DiffBadge[] {
  const preEnvs = (pre?.environmentSettings ?? {}) as Record<
    string,
    FeatureEnvironment
  >;
  const postEnvs = (post.environmentSettings ?? {}) as Record<
    string,
    FeatureEnvironment
  >;
  const badges: DiffBadge[] = [];

  // Env toggle badges stay per-env — "Enabled in production" is a clearer
  // summary than a generic "Toggled environment" aggregate.
  const toggleEnvs = new Set([
    ...Object.keys(preEnvs),
    ...Object.keys(postEnvs),
  ]);
  toggleEnvs.forEach((env) => {
    const preEnabled = preEnvs[env]?.enabled;
    const postEnabled = postEnvs[env]?.enabled;
    if (
      preEnabled !== undefined &&
      postEnabled !== undefined &&
      preEnabled !== postEnabled
    ) {
      badges.push({
        label: postEnabled ? `Enabled in ${env}` : `Disabled in ${env}`,
        action: "toggle",
      });
    }
  });

  // Rule badges operate on the flat rules arrays, env-agnostically.
  badges.push(
    ...featureRuleChangeBadges(
      Array.isArray(pre?.rules) ? (pre?.rules ?? []) : [],
      Array.isArray(post.rules) ? (post.rules ?? []) : [],
    ),
  );

  return badges;
}

// ─── Prerequisite diff helpers ───────────────────────────────────────────────

function analyzePrerequisiteChanges(
  pre: FeaturePrerequisite[],
  post: FeaturePrerequisite[],
) {
  const preById = new Map(pre.map((p) => [p.id, p]));
  const postById = new Map(post.map((p) => [p.id, p]));
  const added = post.filter((p) => !preById.has(p.id));
  const removed = pre.filter((p) => !postById.has(p.id));
  const modified = post.filter(
    (p) => preById.has(p.id) && !isEqual(preById.get(p.id), p),
  );
  return { added, removed, modified };
}

function normPrereqsForDisplay(arr: FeaturePrerequisite[]) {
  return arr.map((p) => ({
    id: p.id,
    condition: toConditionString(p.condition) ?? "{}",
  }));
}

export function prerequisiteChangeBadges(
  pre: FeaturePrerequisite[],
  post: FeaturePrerequisite[],
  label = "prerequisite",
): DiffBadge[] {
  const { added, removed, modified } = analyzePrerequisiteChanges(pre, post);
  const badges: DiffBadge[] = [];
  if (added.length)
    badges.push({
      label: `Add ${label}${added.length > 1 ? ` ×${added.length}` : ""}`,
      action: "add prerequisite",
    });
  if (removed.length)
    badges.push({
      label: `Remove ${label}${removed.length > 1 ? ` ×${removed.length}` : ""}`,
      action: "delete prerequisite",
    });
  if (modified.length)
    badges.push({
      label: `Edit ${label}${modified.length > 1 ? ` ×${modified.length}` : ""}`,
      action: "edit prerequisite",
    });
  return badges;
}

function renderPrerequisiteList(
  pre: FeaturePrerequisite[],
  post: FeaturePrerequisite[],
): ReactNode {
  const { added, removed, modified } = analyzePrerequisiteChanges(pre, post);
  const preById = new Map(pre.map((p) => [p.id, p]));

  if (!added.length && !removed.length && !modified.length) return null;

  const sections: ReactNode[] = [];

  if (added.length > 0) {
    sections.push(
      <div key="added" className="mb-3">
        {added.map((p) => (
          <div key={p.id} className="mb-2">
            <Text
              size="medium"
              weight="medium"
              color="text-mid"
              as="div"
              mb="1"
            >
              Added{" "}
              <Text weight="semibold" color="text-high">
                {p.id}
              </Text>
            </Text>
            <ConditionDisplay prerequisites={normPrereqsForDisplay([p])} />
          </div>
        ))}
      </div>,
    );
  }

  if (removed.length > 0) {
    sections.push(
      <div key="removed" className="mb-3">
        {removed.map((p) => (
          <div key={p.id} className="mb-1">
            <Text size="medium" weight="medium" color="text-mid" as="div">
              Removed{" "}
              <Text weight="semibold" color="text-high">
                {p.id}
              </Text>
            </Text>
          </div>
        ))}
      </div>,
    );
  }

  if (modified.length > 0) {
    sections.push(
      <div key="modified" className="mb-2">
        {modified.map((p) => {
          const prev = preById.get(p.id)!;
          return (
            <div key={p.id} className="mb-3">
              <Text
                size="medium"
                weight="medium"
                color="text-mid"
                as="div"
                mb="1"
              >
                Modified{" "}
                <Text weight="semibold" color="text-high">
                  {p.id}
                </Text>
              </Text>
              <ChangeField
                label="Condition"
                changed
                oldNode={
                  <ConditionDisplay
                    prerequisites={normPrereqsForDisplay([prev])}
                  />
                }
                newNode={
                  <ConditionDisplay
                    prerequisites={normPrereqsForDisplay([p])}
                  />
                }
              />
            </div>
          );
        })}
      </div>,
    );
  }

  return sections.length ? <div className="mt-1">{sections}</div> : null;
}

export function renderEnvPrerequisites(
  envId: string,
  current: FeaturePrerequisite[],
  draft: FeaturePrerequisite[],
): ReactNode {
  const result = renderPrerequisiteList(current, draft);
  if (!result) return null;
  return (
    <div>
      <Text size="small" color="text-low" as="div" mb="2">
        {envId}
      </Text>
      {result}
    </div>
  );
}

export function renderPrerequisites(
  current: FeaturePrerequisite[],
  draft: FeaturePrerequisite[],
): ReactNode {
  return renderPrerequisiteList(current, draft);
}

// Text "On"/"Off" indicator for an environment toggle.
function EnvEnabledIndicator({ enabled }: { enabled: boolean }) {
  return (
    <span
      style={{
        fontSize: "var(--font-size-2)",
        fontWeight: 500,
      }}
    >
      {enabled ? "On" : "Off"}
    </span>
  );
}

export function renderEnvironmentsEnabled(
  current: boolean | undefined,
  draft: boolean | undefined,
): ReactNode {
  if (current === undefined && draft === undefined) return null;
  if (current === draft) return null;
  return (
    <div className="d-flex align-items-center mb-2">
      <div className="text-danger d-flex align-items-center">
        <div className="text-center mr-2" style={{ width: 16 }}>
          Δ
        </div>
        {current === undefined ? (
          <em>unset</em>
        ) : (
          <EnvEnabledIndicator enabled={current} />
        )}
      </div>
      <div className="text-success d-flex align-items-center ml-4">
        <div className="text-center mx-2" style={{ width: 16 }}>
          →
        </div>
        {draft === undefined ? (
          <em>unset</em>
        ) : (
          <EnvEnabledIndicator enabled={draft} />
        )}
      </div>
    </div>
  );
}

// Resolves a holdout ID to its display name and links to the holdout page.
// Falls back to the raw ID, matching the ExperimentLink pattern.
function HoldoutName({ id }: { id: string }): ReactElement {
  const { holdoutsMap } = useHoldouts();
  return (
    <Link href={`/holdout/${id}`} target="_blank">
      {holdoutsMap.get(id)?.name ?? id}
      <PiArrowSquareOut style={{ marginLeft: 3, verticalAlign: "middle" }} />
    </Link>
  );
}

type HoldoutValue = { id: string; value: string } | null | undefined;

export function renderFeatureHoldoutSection(
  pre: Partial<FeatureInterface> | null,
  post: Partial<FeatureInterface>,
): ReactNode | null {
  const preHoldout = (pre?.holdout ?? null) as HoldoutValue;
  const postHoldout = (post.holdout ?? null) as HoldoutValue;

  // Added to a holdout
  if (!preHoldout && postHoldout) {
    return (
      <div>
        <ChangeField
          label="Holdout"
          changed
          oldNode={<em>none</em>}
          newNode={<HoldoutName id={postHoldout.id} />}
        />
        <ValueChangedField
          label="Value"
          pre={null}
          post={formatValue(postHoldout.value)}
        />
      </div>
    );
  }

  // Removed from a holdout
  if (preHoldout && !postHoldout) {
    return (
      <ChangeField
        label="Holdout"
        changed
        oldNode={<HoldoutName id={preHoldout.id} />}
        newNode={<em>none</em>}
      />
    );
  }

  if (!preHoldout || !postHoldout) return null;

  const rows: ReactNode[] = [];

  // Moved to a different holdout
  if (preHoldout.id !== postHoldout.id) {
    rows.push(
      <ChangeField
        key="holdout-id"
        label="Holdout"
        changed
        oldNode={<HoldoutName id={preHoldout.id} />}
        newNode={<HoldoutName id={postHoldout.id} />}
      />,
    );
  }

  if (preHoldout.value !== postHoldout.value) {
    rows.push(
      <ValueChangedField
        key="holdout-value"
        label="Value"
        pre={formatValue(preHoldout.value)}
        post={formatValue(postHoldout.value)}
      />,
    );
  }

  if (!rows.length) return null;

  // Show which holdout this refers to as context above the changes.
  return (
    <div>
      <div className="mb-2">
        <HoldoutName id={postHoldout.id} />
      </div>
      {rows}
    </div>
  );
}

export function getFeatureHoldoutBadges(
  pre: Partial<FeatureInterface> | null,
  post: Partial<FeatureInterface>,
): DiffBadge[] {
  const preHoldout = (pre?.holdout ?? null) as HoldoutValue;
  const postHoldout = (post.holdout ?? null) as HoldoutValue;

  if (!isEqual(preHoldout, postHoldout)) {
    if (!preHoldout && postHoldout)
      return [{ label: "Added to holdout", action: "add holdout" }];
    if (preHoldout && !postHoldout)
      return [{ label: "Removed from holdout", action: "remove holdout" }];
    if (preHoldout?.id !== postHoldout?.id)
      return [{ label: "Changed holdout", action: "change holdout" }];
    return [{ label: "Edit holdout value", action: "edit holdout value" }];
  }
  return [];
}

export function renderRevisionMetadata(
  current: RevisionMetadata | undefined,
  draft: RevisionMetadata,
): ReactNode | null {
  const rows: ReactNode[] = [];

  const stringField = (
    key: string,
    label: string,
    pre: string | undefined,
    post: string | undefined,
  ) => {
    if ((pre || "") !== (post || "")) {
      rows.push(
        <ValueChangedField
          key={key}
          label={label}
          pre={pre ?? null}
          post={post ?? null}
        />,
      );
    }
  };

  if (draft.description !== undefined) {
    stringField(
      "description",
      "Description",
      current?.description,
      draft.description,
    );
  }

  if (
    (current?.owner || "") !== (draft.owner || "") &&
    draft.owner !== undefined
  ) {
    rows.push(
      <ChangeField
        key="owner"
        label="Owner"
        changed
        oldNode={
          current?.owner ? <OwnerName id={current.owner} /> : <em>unset</em>
        }
        newNode={draft.owner ? <OwnerName id={draft.owner} /> : <em>unset</em>}
      />,
    );
  }

  if (
    (current?.project || "") !== (draft.project || "") &&
    draft.project !== undefined
  ) {
    rows.push(
      <ChangeField
        key="project"
        label="Project"
        changed
        oldNode={
          current?.project ? (
            <ProjectName id={current.project} />
          ) : (
            <em>unset</em>
          )
        }
        newNode={
          draft.project ? <ProjectName id={draft.project} /> : <em>unset</em>
        }
      />,
    );
  }

  if (
    (draft.targetingAllProjects !== undefined ||
      draft.targetingProjects !== undefined) &&
    targetingProjectsChanged(
      current?.targetingAllProjects,
      current?.targetingProjects,
      draft.targetingAllProjects,
      draft.targetingProjects,
    )
  ) {
    rows.push(
      <ChangeField
        key="targeting"
        label="Targeting projects"
        changed
        oldNode={renderTargetingNode(
          current?.targetingAllProjects,
          current?.targetingProjects,
        )}
        newNode={renderTargetingNode(
          draft.targetingAllProjects,
          draft.targetingProjects,
        )}
      />,
    );
  }

  if (!isEqual(current?.tags, draft.tags) && draft.tags !== undefined) {
    const preTags = current?.tags ?? [];
    const postTags = draft.tags ?? [];
    const added = postTags.filter((t) => !preTags.includes(t));
    const removed = preTags.filter((t) => !postTags.includes(t));
    if (added.length || removed.length) {
      rows.push(
        <ChangeField
          key="tags"
          label="Tags"
          changed
          oldNode={
            current?.tags?.length ? (
              <SortedTags
                tags={current.tags}
                useFlex
                shouldShowEllipsis={false}
              />
            ) : (
              <em>unset</em>
            )
          }
          newNode={
            draft.tags?.length ? (
              <SortedTags
                tags={draft.tags}
                useFlex
                shouldShowEllipsis={false}
              />
            ) : (
              <em>unset</em>
            )
          }
        />,
      );
    }
  }

  if (
    current?.neverStale !== draft.neverStale &&
    draft.neverStale !== undefined
  ) {
    rows.push(
      <ValueChangedField
        key="neverStale"
        label="Never Stale"
        pre={
          current?.neverStale !== undefined ? String(current.neverStale) : null
        }
        post={String(draft.neverStale)}
      />,
    );
  }

  if (
    !isEqual(current?.jsonSchema, draft.jsonSchema) &&
    draft.jsonSchema !== undefined
  ) {
    rows.push(
      <ValueChangedField
        key="jsonSchema"
        label="JSON Schema"
        pre={
          current?.jsonSchema
            ? JSON.stringify(current.jsonSchema, null, 2)
            : null
        }
        post={JSON.stringify(draft.jsonSchema, null, 2)}
      />,
    );
  }

  if (
    !isEqual(current?.customFields, draft.customFields) &&
    draft.customFields !== undefined
  ) {
    rows.push(
      <ValueChangedField
        key="customFields"
        label="Custom Fields"
        pre={
          current?.customFields
            ? JSON.stringify(current.customFields, null, 2)
            : null
        }
        post={JSON.stringify(draft.customFields, null, 2)}
      />,
    );
  }

  return rows.length ? <div>{rows}</div> : null;
}
