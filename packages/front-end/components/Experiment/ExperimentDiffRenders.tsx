/**
 * Human-readable summary renders for each ExperimentDiffSection.
 * Each function is wired as the `render` prop on an AuditDiffSection and is
 * displayed *above* the raw JSON ExpandableDiff for that section.
 *
 * Receives the already-picked Partial snapshots for the section (only the keys
 * claimed by that section are present), so field access is safe.
 *
 * Visual language mirrors TargetingInfo.tsx: changed fields show
 *   Δ old-value (red)  →  new-value (green)
 */

import React, { ReactNode } from "react";
import isEqual from "lodash/isEqual";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { FeaturePrerequisite, SavedGroupTargeting } from "shared/types/feature";
import { getMetricLink } from "shared/experiments";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import SavedGroupTargetingDisplay from "@/components/Features/SavedGroupTargetingDisplay";
import { formatTrafficSplit } from "@/services/utils";
import { useDefinitions } from "@/services/DefinitionsContext";
import MetricName from "@/components/Metrics/MetricName";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import Text from "@/ui/Text";

type Pre = Partial<ExperimentInterfaceStringDates> | null;
type Post = Partial<ExperimentInterfaceStringDates>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

/**
 * After normalizeSnapshot runs, `condition` fields may already be parsed
 * objects. ConditionDisplay expects a JSON string, so re-stringify if needed.
 */
function toConditionString(cond: unknown): string | undefined {
  if (!cond) return undefined;
  if (typeof cond === "string") return cond;
  return JSON.stringify(cond);
}

function normalizePrereqs(prereqs: unknown): FeaturePrerequisite[] | undefined {
  if (!Array.isArray(prereqs) || !prereqs.length) return undefined;
  return prereqs.map((p) => ({
    id: p.id as string,
    condition: toConditionString(p.condition) ?? "{}",
  }));
}

/** Convert camelCase key to a human-readable label ("hashAttribute" → "Hash attribute"). */
function camelToLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

/**
 * Generic before→after row for fields that don't have a dedicated renderer.
 * Scalars and booleans are shown as plain text; objects/arrays as compact JSON.
 */
function GenericFieldChange({
  fieldKey,
  preVal,
  postVal,
}: {
  fieldKey: string;
  preVal: unknown;
  postVal: unknown;
}) {
  if (isEqual(preVal, postVal)) return null;
  const fmt = (v: unknown): ReactNode => {
    if (v === null || v === undefined) return <em>unset</em>;
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "string" || typeof v === "number") return String(v);
    return (
      <code style={{ fontSize: "var(--font-size-1)", wordBreak: "break-all" }}>
        {JSON.stringify(v)}
      </code>
    );
  };
  return (
    <ChangeField
      label={camelToLabel(fieldKey)}
      changed
      oldNode={fmt(preVal)}
      newNode={fmt(postVal)}
    />
  );
}

/**
 * Appends GenericFieldChange rows for any keys in `post` that changed but are
 * not listed in `handled`. Call at the end of each render function for
 * forward-compatible coverage of new fields.
 */
function renderFallback(
  pre: Record<string, unknown> | null | undefined,
  post: Record<string, unknown>,
  handled: Set<string>,
): ReactNode[] {
  return Object.keys(post)
    .filter((k) => !handled.has(k) && !isEqual(pre?.[k], post[k]))
    .map((k) => (
      <GenericFieldChange
        key={k}
        fieldKey={k}
        preVal={pre?.[k]}
        postVal={post[k]}
      />
    ));
}

/**
 * A labeled field row that shows "Δ old (red) → new (green)" only when
 * something changed. Pass `changed={false}` to suppress the row entirely.
 */
function ChangeField({
  label,
  changed,
  oldNode,
  newNode,
}: {
  label: string;
  changed: boolean;
  oldNode: ReactNode;
  newNode: ReactNode;
}) {
  if (!changed) return null;
  return (
    <div className="mb-2">
      <div className="mb-1">
        <Text size="medium" weight="medium" color="text-mid">
          {label}
        </Text>
      </div>
      <div className="d-flex align-items-start">
        <div className="text-danger d-flex align-items-start">
          <div className="text-center mr-2" style={{ width: 16 }}>
            Δ
          </div>
          <div>{oldNode}</div>
        </div>
        <div className="font-weight-bold text-success d-flex align-items-start ml-4">
          <div className="text-center mx-2" style={{ width: 16 }}>
            →
          </div>
          <div>{newNode}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * Stacked before → after display for multi-line text fields (hypothesis,
 * description). Each value sits in a scrollable read-only box so long content
 * doesn't swamp the layout.
 */
function TextChangedField({
  label,
  pre,
  post,
}: {
  label: string;
  pre: string | null | undefined;
  post: string | null | undefined;
}) {
  if (isEqual(pre, post)) return null;

  const TextBox = ({
    value,
    marker,
    colorClass,
  }: {
    value: string | null | undefined;
    marker: string;
    colorClass: string;
  }) => (
    <div className={`d-flex align-items-start mb-1 ${colorClass}`}>
      <div
        className="text-center font-weight-bold mr-2 mt-1"
        style={{ width: 16, flexShrink: 0, lineHeight: "1.6" }}
      >
        {marker}
      </div>
      <div
        style={{
          flex: 1,
          border: "1px solid var(--gray-5)",
          borderRadius: "var(--radius-2)",
          padding: "6px 10px",
          background: "var(--gray-2)",
          maxHeight: 90,
          overflowY: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontSize: "var(--font-size-1)",
          lineHeight: 1.5,
        }}
      >
        {value || <em className="text-muted">None</em>}
      </div>
    </div>
  );

  return (
    <div className="mb-2">
      <div className="mb-1">
        <Text size="medium" weight="medium" color="text-mid">
          {label}
        </Text>
      </div>
      <TextBox value={pre} marker="Δ" colorClass="text-danger" />
      <TextBox value={post} marker="→" colorClass="text-success" />
    </div>
  );
}

/**
 * Renders a metric ID as a signed badge label using MetricName (which includes
 * links, group icons, official badges, etc.). Falls back to the raw ID for
 * metrics not yet loaded — MetricName returns null for missing non-group
 * metrics, so we check existence first.
 */
function MetricBadgeLabel({ id, sign }: { id: string; sign: "+" | "−" }) {
  const { getExperimentMetricById, getMetricGroupById } = useDefinitions();
  const isGroup = id.startsWith("mg_");
  const group = isGroup ? getMetricGroupById(id) : null;
  const exists = isGroup ? !!group : !!getExperimentMetricById(id);

  // Build the metrics prop required for metric group tooltips.
  const groupMetrics = group
    ? group.metrics.map((mid) => ({
        metric: getExperimentMetricById(mid) ?? null,
        joinable: true,
      }))
    : undefined;

  return (
    <span className="d-inline-flex align-items-center" style={{ gap: 3 }}>
      {sign}{" "}
      {exists ? (
        <Link
          href={isGroup ? `/metric-groups/${id}` : getMetricLink(id)}
          target="_blank"
        >
          <MetricName
            id={id}
            isGroup={isGroup}
            showGroupIcon
            disableTooltip={false}
            metrics={groupMetrics}
          />
        </Link>
      ) : (
        id
      )}
    </span>
  );
}

/**
 * Shows added/removed metric IDs as signed badges with resolved names.
 */
function MetricDiff({
  label,
  preArr,
  postArr,
}: {
  label: string;
  preArr?: string[] | null;
  postArr?: string[] | null;
}) {
  const a = preArr ?? [];
  const b = postArr ?? [];
  const added = b.filter((id) => !a.includes(id));
  const removed = a.filter((id) => !b.includes(id));
  if (!added.length && !removed.length) return null;

  return (
    <div className="mb-2">
      <div className="mb-1">
        <Text size="medium" weight="medium" color="text-mid">
          {label}
        </Text>
      </div>
      <div className="d-flex flex-wrap" style={{ gap: 4 }}>
        {removed.map((id) => (
          <Badge
            key={id}
            label={<MetricBadgeLabel id={id} sign="−" />}
            color="red"
            variant="soft"
          />
        ))}
        {added.map((id) => (
          <Badge
            key={id}
            label={<MetricBadgeLabel id={id} sign="+" />}
            color="green"
            variant="soft"
          />
        ))}
      </div>
    </div>
  );
}

// ─── Section renders ──────────────────────────────────────────────────────────

type PhaseTargeting = {
  coverage?: number;
  condition?: unknown;
  savedGroups?: SavedGroupTargeting[];
  prerequisites?: unknown[];
  variationWeights?: number[];
  namespace?: {
    enabled: boolean;
    name: string;
    range: [number, number];
  } | null;
  seed?: string;
};

/**
 * "User targeting" – phases sub-keys: condition, savedGroups, prerequisites,
 * coverage, variationWeights, namespace, seed.
 */
export function renderUserTargetingPhases(
  pre: Pre,
  post: Post,
): ReactNode | null {
  const prePhases = (pre?.phases ?? []) as PhaseTargeting[];
  const postPhases = (post.phases ?? []) as PhaseTargeting[];

  const sections: ReactNode[] = [];
  const multi = postPhases.length > 1;

  postPhases.forEach((postP, i) => {
    const preP = prePhases[i] ?? {};
    const ph = multi ? ` (Phase ${i + 1})` : "";

    // ── Attribute targeting (condition) ──────────────────────────────────────
    const condChanged = !isEqual(preP.condition, postP.condition);
    if (condChanged) {
      const preStr = toConditionString(preP.condition);
      const postStr = toConditionString(postP.condition);
      sections.push(
        <ChangeField
          key={`cond-${i}`}
          label={`Attribute targeting${ph}`}
          changed
          oldNode={
            preStr && preStr !== "{}" ? (
              <ConditionDisplay condition={preStr} />
            ) : (
              <em>None</em>
            )
          }
          newNode={
            postStr && postStr !== "{}" ? (
              <ConditionDisplay condition={postStr} />
            ) : (
              <em>None</em>
            )
          }
        />,
      );
    }

    // ── Saved group targeting ─────────────────────────────────────────────────
    const sgChanged = !isEqual(preP.savedGroups, postP.savedGroups);
    if (sgChanged) {
      sections.push(
        <ChangeField
          key={`sg-${i}`}
          label={`Saved group targeting${ph}`}
          changed
          oldNode={
            preP.savedGroups?.length ? (
              <SavedGroupTargetingDisplay savedGroups={preP.savedGroups} />
            ) : (
              <em>None</em>
            )
          }
          newNode={
            postP.savedGroups?.length ? (
              <SavedGroupTargetingDisplay savedGroups={postP.savedGroups} />
            ) : (
              <em>None</em>
            )
          }
        />,
      );
    }

    // ── Prerequisite targeting ────────────────────────────────────────────────
    const prereqChanged = !isEqual(preP.prerequisites, postP.prerequisites);
    if (prereqChanged) {
      const prePrereqs = normalizePrereqs(preP.prerequisites);
      const postPrereqs = normalizePrereqs(postP.prerequisites);
      sections.push(
        <ChangeField
          key={`prereq-${i}`}
          label={`Prerequisite targeting${ph}`}
          changed
          oldNode={
            prePrereqs?.length ? (
              <ConditionDisplay prerequisites={prePrereqs} />
            ) : (
              <em>None</em>
            )
          }
          newNode={
            postPrereqs?.length ? (
              <ConditionDisplay prerequisites={postPrereqs} />
            ) : (
              <em>None</em>
            )
          }
        />,
      );
    }

    // ── Traffic (coverage + weights) ─────────────────────────────────────────
    const coverageChanged = !isEqual(preP.coverage, postP.coverage);
    const weightsChanged = !isEqual(
      preP.variationWeights,
      postP.variationWeights,
    );
    if (coverageChanged || weightsChanged) {
      const fmtTraffic = (p: PhaseTargeting) => {
        const cov =
          p.coverage !== undefined ? percentFormatter.format(p.coverage) : "—";
        const split = p.variationWeights?.length
          ? `, ${formatTrafficSplit(p.variationWeights, 0)} split`
          : "";
        return `${cov} included${split}`;
      };
      sections.push(
        <ChangeField
          key={`traffic-${i}`}
          label={`Traffic${ph}`}
          changed
          oldNode={fmtTraffic(preP)}
          newNode={fmtTraffic(postP)}
        />,
      );
    }

    // ── Namespace ─────────────────────────────────────────────────────────────
    const nsChanged = !isEqual(preP.namespace, postP.namespace);
    if (nsChanged) {
      const fmtNs = (ns: PhaseTargeting["namespace"]) =>
        ns?.enabled
          ? `${ns.name} (${percentFormatter.format(ns.range[1] - ns.range[0])})`
          : "Global (all users)";
      sections.push(
        <ChangeField
          key={`ns-${i}`}
          label={`Namespace${ph}`}
          changed
          oldNode={fmtNs(preP.namespace)}
          newNode={fmtNs(postP.namespace)}
        />,
      );
    }

    // ── Hash seed ─────────────────────────────────────────────────────────────
    if (!isEqual(preP.seed, postP.seed) && postP.seed !== undefined) {
      sections.push(
        <ChangeField
          key={`seed-${i}`}
          label={`Hash seed${ph}`}
          changed
          oldNode={preP.seed ?? <em>None</em>}
          newNode={postP.seed || <em>None</em>}
        />,
      );
    }
  });

  return sections.length ? <div className="mt-1">{sections}</div> : null;
}

/**
 * "User targeting" – top-level fields: disableStickyBucketing,
 * excludeFromPayload, bucketVersion, minBucketVersion.
 */
export function renderUserTargetingTopLevel(
  pre: Pre,
  post: Post,
): ReactNode | null {
  const rows: ReactNode[] = [];

  if (
    !isEqual(pre?.disableStickyBucketing, post.disableStickyBucketing) &&
    post.disableStickyBucketing !== undefined
  ) {
    const fmt = (v: boolean | undefined): React.ReactNode =>
      v === undefined ? <em>unset</em> : v ? "disabled" : "enabled";
    rows.push(
      <ChangeField
        key="sticky"
        label="Sticky bucketing"
        changed
        oldNode={fmt(pre?.disableStickyBucketing)}
        newNode={fmt(post.disableStickyBucketing)}
      />,
    );
  }

  if (
    !isEqual(pre?.excludeFromPayload, post.excludeFromPayload) &&
    post.excludeFromPayload !== undefined
  ) {
    rows.push(
      <ChangeField
        key="excl"
        label="Exclude from SDK payload"
        changed
        oldNode={
          pre?.excludeFromPayload !== undefined ? (
            String(pre.excludeFromPayload)
          ) : (
            <em>unset</em>
          )
        }
        newNode={String(post.excludeFromPayload)}
      />,
    );
  }

  if (
    !isEqual(pre?.bucketVersion, post.bucketVersion) &&
    post.bucketVersion !== undefined
  ) {
    rows.push(
      <ChangeField
        key="bv"
        label="Bucket version"
        changed
        oldNode={
          pre?.bucketVersion !== undefined ? (
            String(pre.bucketVersion)
          ) : (
            <em>unset</em>
          )
        }
        newNode={String(post.bucketVersion)}
      />,
    );
  }

  if (
    !isEqual(pre?.minBucketVersion, post.minBucketVersion) &&
    post.minBucketVersion !== undefined
  ) {
    rows.push(
      <ChangeField
        key="mbv"
        label="Min bucket version"
        changed
        oldNode={
          pre?.minBucketVersion !== undefined ? (
            String(pre.minBucketVersion)
          ) : (
            <em>unset</em>
          )
        }
        newNode={String(post.minBucketVersion)}
      />,
    );
  }

  const handled = new Set([
    "excludeFromPayload",
    "bucketVersion",
    "minBucketVersion",
    "disableStickyBucketing",
  ]);
  rows.push(
    ...renderFallback(
      pre as Record<string, unknown>,
      post as Record<string, unknown>,
      handled,
    ),
  );

  return rows.length ? <div className="mt-1">{rows}</div> : null;
}

/**
 * "Phase info" – phases sub-keys: dateStarted, dateEnded, name, reason.
 */
export function renderPhaseInfo(pre: Pre, post: Post): ReactNode | null {
  type PhaseInfo = {
    dateStarted?: string;
    dateEnded?: string;
    name?: string;
    reason?: string;
    lookbackStartDate?: string | Date;
  };
  const prePhases = (pre?.phases ?? []) as PhaseInfo[];
  const postPhases = (post.phases ?? []) as PhaseInfo[];

  const sections: ReactNode[] = [];
  const multi = postPhases.length > 1;

  postPhases.forEach((postP, i) => {
    const preP = prePhases[i] ?? {};
    const ph = multi ? ` (Phase ${i + 1})` : "";

    if (!isEqual(preP.dateStarted, postP.dateStarted) && postP.dateStarted) {
      sections.push(
        <ChangeField
          key={`start-${i}`}
          label={`Start date${ph}`}
          changed
          oldNode={
            preP.dateStarted ? (
              new Date(preP.dateStarted).toLocaleString()
            ) : (
              <em>None</em>
            )
          }
          newNode={new Date(postP.dateStarted).toLocaleString()}
        />,
      );
    }

    if (!isEqual(preP.dateEnded, postP.dateEnded)) {
      sections.push(
        <ChangeField
          key={`end-${i}`}
          label={`End date${ph}`}
          changed
          oldNode={
            preP.dateEnded ? (
              new Date(preP.dateEnded).toLocaleString()
            ) : (
              <em>None</em>
            )
          }
          newNode={
            postP.dateEnded ? (
              new Date(postP.dateEnded).toLocaleString()
            ) : (
              <em>None</em>
            )
          }
        />,
      );
    }

    if (!isEqual(preP.name, postP.name) && postP.name) {
      sections.push(
        <ChangeField
          key={`name-${i}`}
          label={`Phase name${ph}`}
          changed
          oldNode={preP.name ?? <em>None</em>}
          newNode={postP.name}
        />,
      );
    }

    if (!isEqual(preP.reason, postP.reason) && postP.reason) {
      sections.push(
        <ChangeField
          key={`reason-${i}`}
          label={`Stop reason${ph}`}
          changed
          oldNode={preP.reason ?? <em>None</em>}
          newNode={postP.reason}
        />,
      );
    }

    if (
      !isEqual(preP.lookbackStartDate, postP.lookbackStartDate) &&
      postP.lookbackStartDate
    ) {
      const d = postP.lookbackStartDate as unknown;
      const preD = preP.lookbackStartDate as unknown;
      const fmt = (v: unknown) =>
        v ? new Date(v as string | Date).toLocaleString() : <em>None</em>;
      sections.push(
        <ChangeField
          key={`lookback-${i}`}
          label={`Lookback start${ph}`}
          changed
          oldNode={fmt(preD)}
          newNode={fmt(d)}
        />,
      );
    }
  });

  return sections.length ? <div className="mt-1">{sections}</div> : null;
}

/**
 * "Variations" – shows the variation list with names and keys.
 * Highlights added, removed, and renamed entries.
 */
export function renderVariations(pre: Pre, post: Post): ReactNode | null {
  type Variation = { name: string; key: string };
  const preVars = (pre?.variations ?? []) as Variation[];
  const postVars = (post.variations ?? []) as Variation[];

  if (!postVars.length && !preVars.length) return null;

  const rows: ReactNode[] = [];

  postVars.forEach((v, i) => {
    const preV = preVars[i];
    const nameChanged = preV && preV.name !== v.name;
    const keyChanged = preV && preV.key !== v.key;
    const added = !preV;

    if (added || nameChanged || keyChanged) {
      rows.push(
        <ChangeField
          key={`v-${i}`}
          label={`Variation ${i}`}
          changed
          oldNode={preV ? `${preV.name} (${preV.key})` : <em>new</em>}
          newNode={`${v.name} (${v.key})`}
        />,
      );
    }
  });

  preVars.slice(postVars.length).forEach((v, i) => {
    rows.push(
      <ChangeField
        key={`v-rm-${i}`}
        label={`Variation ${postVars.length + i}`}
        changed
        oldNode={`${v.name} (${v.key})`}
        newNode={<em>removed</em>}
      />,
    );
  });

  return rows.length ? <div className="mt-1">{rows}</div> : null;
}

/**
 * "Analysis settings" – metric list changes, stats engine, hash attribute, etc.
 */
function ActivationMetricName({ id }: { id: string | undefined | null }) {
  const { getExperimentMetricById } = useDefinitions();
  if (!id) return <em>unset</em>;
  const exists = !!getExperimentMetricById(id);
  return exists ? (
    <Link href={getMetricLink(id)} target="_blank">
      <MetricName id={id} disableTooltip={false} />
    </Link>
  ) : (
    <>{id}</>
  );
}

export function renderAnalysisSettings(pre: Pre, post: Post): ReactNode | null {
  const rows: ReactNode[] = [];

  const goalRow = (
    <MetricDiff
      key="goal"
      label="Goal metrics"
      preArr={pre?.goalMetrics}
      postArr={post.goalMetrics}
    />
  );
  if (goalRow) rows.push(goalRow);

  const secRow = (
    <MetricDiff
      key="sec"
      label="Secondary metrics"
      preArr={pre?.secondaryMetrics}
      postArr={post.secondaryMetrics}
    />
  );
  if (secRow) rows.push(secRow);

  const grRow = (
    <MetricDiff
      key="gr"
      label="Guardrail metrics"
      preArr={pre?.guardrailMetrics}
      postArr={post.guardrailMetrics}
    />
  );
  if (grRow) rows.push(grRow);

  if (
    !isEqual(pre?.activationMetric, post.activationMetric) &&
    post.activationMetric !== undefined
  ) {
    rows.push(
      <ChangeField
        key="act"
        label="Activation metric"
        changed
        oldNode={<ActivationMetricName id={pre?.activationMetric} />}
        newNode={<ActivationMetricName id={post.activationMetric} />}
      />,
    );
  }

  // ── Simple scalar fields ───────────────────────────────────────────────────
  const scalarFields: [keyof ExperimentInterfaceStringDates, string][] = [
    ["hashAttribute", "Hash attribute"],
    ["fallbackAttribute", "Fallback attribute"],
    ["hashVersion", "Hash version"],
    ["statsEngine", "Stats engine"],
    ["attributionModel", "Attribution model"],
    ["datasource", "Data source"],
    ["exposureQueryId", "Exposure query ID"],
    ["trackingKey", "Tracking key"],
    ["segment", "Segment"],
    ["sequentialTestingTuningParameter", "Sequential testing tuning parameter"],
  ];

  for (const [field, label] of scalarFields) {
    if (!isEqual(pre?.[field], post[field]) && post[field] !== undefined) {
      rows.push(
        <ChangeField
          key={field}
          label={label}
          changed
          oldNode={
            pre?.[field] !== undefined ? String(pre[field]) : <em>unset</em>
          }
          newNode={String(post[field])}
        />,
      );
    }
  }

  // ── Boolean toggles ────────────────────────────────────────────────────────
  const boolFields: [keyof ExperimentInterfaceStringDates, string][] = [
    ["skipPartialData", "Skip partial data"],
    ["regressionAdjustmentEnabled", "Regression adjustment"],
    ["postStratificationEnabled", "Post-stratification"],
    ["sequentialTestingEnabled", "Sequential testing"],
  ];

  const fmtBool = (v: unknown): ReactNode =>
    v === null || v === undefined ? <em>unset</em> : v ? "enabled" : "disabled";

  for (const [field, label] of boolFields) {
    if (!isEqual(pre?.[field], post[field]) && post[field] !== undefined) {
      rows.push(
        <ChangeField
          key={field}
          label={label}
          changed
          oldNode={fmtBool(pre?.[field])}
          newNode={fmtBool(post[field])}
        />,
      );
    }
  }

  // ── Bandit schedule / burn-in ──────────────────────────────────────────────
  const fmtBandit = (val: number | undefined, unit: string | undefined) =>
    val !== undefined ? `${val} ${unit ?? ""}`.trim() : <em>unset</em>;

  const banditBurnChanged =
    !isEqual(pre?.banditBurnInValue, post.banditBurnInValue) ||
    !isEqual(pre?.banditBurnInUnit, post.banditBurnInUnit);
  if (banditBurnChanged && post.banditBurnInValue !== undefined) {
    rows.push(
      <ChangeField
        key="banditBurnIn"
        label="Bandit burn-in period"
        changed
        oldNode={fmtBandit(pre?.banditBurnInValue, pre?.banditBurnInUnit)}
        newNode={fmtBandit(post.banditBurnInValue, post.banditBurnInUnit)}
      />,
    );
  }

  const banditScheduleChanged =
    !isEqual(pre?.banditScheduleValue, post.banditScheduleValue) ||
    !isEqual(pre?.banditScheduleUnit, post.banditScheduleUnit);
  if (banditScheduleChanged && post.banditScheduleValue !== undefined) {
    rows.push(
      <ChangeField
        key="banditSchedule"
        label="Bandit schedule"
        changed
        oldNode={fmtBandit(pre?.banditScheduleValue, pre?.banditScheduleUnit)}
        newNode={fmtBandit(post.banditScheduleValue, post.banditScheduleUnit)}
      />,
    );
  }

  // ── Long-text fields ───────────────────────────────────────────────────────
  if (
    !isEqual(pre?.queryFilter, post.queryFilter) &&
    post.queryFilter !== undefined
  ) {
    rows.push(
      <TextChangedField
        key="queryFilter"
        label="Query filter"
        pre={pre?.queryFilter}
        post={post.queryFilter}
      />,
    );
  }

  // ── Fallback for any future/unhandled fields ───────────────────────────────
  const handled = new Set([
    "goalMetrics",
    "secondaryMetrics",
    "guardrailMetrics",
    "activationMetric",
    "metricOverrides",
    "decisionFrameworkSettings",
    "customMetricSlices",
    "hashAttribute",
    "fallbackAttribute",
    "hashVersion",
    "statsEngine",
    "attributionModel",
    "datasource",
    "exposureQueryId",
    "trackingKey",
    "segment",
    "queryFilter",
    "skipPartialData",
    "regressionAdjustmentEnabled",
    "postStratificationEnabled",
    "sequentialTestingEnabled",
    "sequentialTestingTuningParameter",
    "banditBurnInValue",
    "banditBurnInUnit",
    "banditScheduleValue",
    "banditScheduleUnit",
  ]);
  rows.push(
    ...renderFallback(
      pre as Record<string, unknown>,
      post as Record<string, unknown>,
      handled,
    ),
  );

  return rows.length ? <div className="mt-1">{rows}</div> : null;
}

/**
 * "Metadata" – name, owner, tags, hypothesis, description, type.
 */
export function renderMetadata(pre: Pre, post: Post): ReactNode | null {
  const rows: ReactNode[] = [];

  if (!isEqual(pre?.name, post.name) && post.name !== undefined) {
    rows.push(
      <ChangeField
        key="name"
        label="Name"
        changed
        oldNode={pre?.name ?? <em>None</em>}
        newNode={post.name}
      />,
    );
  }

  if (!isEqual(pre?.owner, post.owner) && post.owner !== undefined) {
    rows.push(
      <ChangeField
        key="owner"
        label="Owner"
        changed
        oldNode={pre?.owner ?? <em>None</em>}
        newNode={post.owner}
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

  if (!isEqual(pre?.type, post.type) && post.type !== undefined) {
    rows.push(
      <ChangeField
        key="type"
        label="Type"
        changed
        oldNode={pre?.type ?? <em>unset</em>}
        newNode={post.type}
      />,
    );
  }

  if (
    !isEqual(pre?.hypothesis, post.hypothesis) &&
    post.hypothesis !== undefined
  ) {
    rows.push(
      <TextChangedField
        key="hyp"
        label="Hypothesis"
        pre={pre?.hypothesis}
        post={post.hypothesis}
      />,
    );
  }

  if (
    !isEqual(pre?.description, post.description) &&
    post.description !== undefined
  ) {
    rows.push(
      <TextChangedField
        key="desc"
        label="Description"
        pre={pre?.description}
        post={post.description}
      />,
    );
  }

  if (
    !isEqual(pre?.shareLevel, post.shareLevel) &&
    post.shareLevel !== undefined
  ) {
    rows.push(
      <ChangeField
        key="shareLevel"
        label="Share level"
        changed
        oldNode={pre?.shareLevel ?? <em>unset</em>}
        newNode={post.shareLevel}
      />,
    );
  }

  if (
    !isEqual(pre?.templateId, post.templateId) &&
    post.templateId !== undefined
  ) {
    rows.push(
      <ChangeField
        key="templateId"
        label="Template ID"
        changed
        oldNode={pre?.templateId ?? <em>unset</em>}
        newNode={post.templateId}
      />,
    );
  }

  const handled = new Set([
    "name",
    "owner",
    "tags",
    "type",
    "hypothesis",
    "description",
    "shareLevel",
    "templateId",
    "project",
  ]);
  rows.push(
    ...renderFallback(
      pre as Record<string, unknown>,
      post as Record<string, unknown>,
      handled,
    ),
  );

  return rows.length ? <div className="mt-1">{rows}</div> : null;
}
