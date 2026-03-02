import { ReactNode } from "react";
import isEqual from "lodash/isEqual";
import {
  ExperimentInterfaceStringDates,
  Variation,
} from "shared/types/experiment";
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
import type { DiffBadge } from "@/components/AuditHistoryExplorer/types";
import {
  toConditionString,
  camelToLabel,
  ChangeField,
  TextChangedField,
  GenericFieldChange,
  renderFallback,
  ProjectName,
} from "@/components/AuditHistoryExplorer/DiffRenderUtils";
export type { DiffBadge };
export {
  toConditionString,
  camelToLabel,
  ChangeField,
  TextChangedField,
  GenericFieldChange,
  renderFallback,
  ProjectName,
};

type Pre = Partial<ExperimentInterfaceStringDates> | null;
type Post = Partial<ExperimentInterfaceStringDates>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

function normalizePrereqs(prereqs: unknown): FeaturePrerequisite[] | undefined {
  if (!Array.isArray(prereqs) || !prereqs.length) return undefined;
  return prereqs.map((p) => ({
    id: p.id as string,
    condition: toConditionString(p.condition) ?? "{}",
  }));
}

// Metric ID as a signed badge. Uses MetricName for resolved display; falls back to raw ID.
function MetricBadgeLabel({ id, sign }: { id: string; sign: "+" | "−" }) {
  const { getExperimentMetricById, getMetricGroupById } = useDefinitions();
  const isGroup = id.startsWith("mg_");
  const group = isGroup ? getMetricGroupById(id) : null;
  const exists = isGroup ? !!group : !!getExperimentMetricById(id);

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
            officialBadgeLeftGap={false}
          />
        </Link>
      ) : (
        id
      )}
    </span>
  );
}

// Added/removed metric IDs as signed badges with resolved names.
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

// "User targeting" — phases: condition, savedGroups, prerequisites, coverage, weights, namespace.
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

// "User targeting" — top-level: disableStickyBucketing, excludeFromPayload, bucketVersion.
export function renderUserTargetingTopLevel(
  pre: Pre,
  post: Post,
): ReactNode | null {
  const rows: ReactNode[] = [];

  if (
    !isEqual(pre?.disableStickyBucketing, post.disableStickyBucketing) &&
    post.disableStickyBucketing !== undefined
  ) {
    const fmt = (v: boolean | undefined): ReactNode =>
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

  const handled = new Set(["disableStickyBucketing"]);
  rows.push(
    ...renderFallback(
      pre as Record<string, unknown>,
      post as Record<string, unknown>,
      handled,
    ),
  );

  return rows.length ? <div className="mt-1">{rows}</div> : null;
}

// "Phase info" — phases: dateStarted, dateEnded, name, reason, and variations.
export function renderPhaseInfo(pre: Pre, post: Post): ReactNode | null {
  type PhaseInfo = {
    dateStarted?: string;
    dateEnded?: string;
    name?: string;
    reason?: string;
    lookbackStartDate?: string | Date;
    variations?: Variation[];
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

    if (!isEqual(preP.variations, postP.variations)) {
      renderVariations(preP.variations ?? [], postP.variations ?? []);
    }
  });

  return sections.length ? <div className="mt-1">{sections}</div> : null;
}

// "Variations" — list with names and keys; highlights added, removed, renamed.
function renderVariations(
  pre: Variation[],
  post: Variation[],
): ReactNode | null {
  const preVars = pre;
  const postVars = post;

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

function ActivationMetricName({ id }: { id: string | undefined | null }) {
  const { getExperimentMetricById } = useDefinitions();
  if (!id) return <em>unset</em>;
  const exists = !!getExperimentMetricById(id);
  return exists ? (
    <Link href={getMetricLink(id)} target="_blank">
      <MetricName id={id} disableTooltip={false} officialBadgeLeftGap={false} />
    </Link>
  ) : (
    <>{id}</>
  );
}

// Returns true when two metric ID arrays have any additions or removals.
function metricsChanged(
  a: string[] | null | undefined,
  b: string[] | null | undefined,
): boolean {
  const pre = a ?? [];
  const post = b ?? [];
  return (
    post.some((id) => !pre.includes(id)) || pre.some((id) => !post.includes(id))
  );
}

export function renderAnalysisSettings(pre: Pre, post: Post): ReactNode | null {
  const rows: ReactNode[] = [];

  if (metricsChanged(pre?.goalMetrics, post.goalMetrics)) {
    rows.push(
      <MetricDiff
        key="goal"
        label="Goal metrics"
        preArr={pre?.goalMetrics}
        postArr={post.goalMetrics}
      />,
    );
  }

  if (metricsChanged(pre?.secondaryMetrics, post.secondaryMetrics)) {
    rows.push(
      <MetricDiff
        key="sec"
        label="Secondary metrics"
        preArr={pre?.secondaryMetrics}
        postArr={post.secondaryMetrics}
      />,
    );
  }

  if (metricsChanged(pre?.guardrailMetrics, post.guardrailMetrics)) {
    rows.push(
      <MetricDiff
        key="gr"
        label="Guardrail metrics"
        preArr={pre?.guardrailMetrics}
        postArr={post.guardrailMetrics}
      />,
    );
  }

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
    "queryFilter",
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

  if (!isEqual(pre?.project, post.project) && post.project !== undefined) {
    rows.push(
      <ChangeField
        key="project"
        label="Project"
        changed
        oldNode={
          pre?.project ? <ProjectName id={pre.project} /> : <em>None</em>
        }
        newNode={
          post.project ? <ProjectName id={post.project} /> : <em>None</em>
        }
      />,
    );
  }

  const handled = new Set(["tags", "hypothesis", "description", "project"]);
  rows.push(
    ...renderFallback(
      pre as Record<string, unknown>,
      post as Record<string, unknown>,
      handled,
    ),
  );

  return rows.length ? <div className="mt-1">{rows}</div> : null;
}

// ─── Badge getters ────────────────────────────────────────────────────────────

export function getExperimentTargetingBadges(): DiffBadge[] {
  return [{ label: "Edit targeting", action: "edit targeting" }];
}

export function getExperimentPhaseInfoBadges(
  pre: Pre,
  post: Post,
): DiffBadge[] {
  const prePhases = (pre?.phases ?? []) as { dateEnded?: string | null }[];
  const postPhases = (post.phases ?? []) as { dateEnded?: string | null }[];
  if (postPhases.length > prePhases.length)
    return [{ label: "New phase", action: "new phase" }];
  if (postPhases.length < prePhases.length)
    return [{ label: "Phase deleted", action: "delete phase" }];
  const wasEnded = postPhases.some(
    (p, i) => p.dateEnded && !prePhases[i]?.dateEnded,
  );
  if (wasEnded) return [{ label: "Phase ended", action: "end phase" }];
  return [{ label: "Edit phase", action: "edit phase" }];
}

export function getExperimentVariationsBadges(
  pre: Pre,
  post: Post,
): DiffBadge[] {
  const prePhases = pre?.phases ?? [];
  const postPhases = post.phases ?? [];

  // Only compare latest phases
  const prePhase = prePhases[prePhases.length - 1];
  const postPhase = postPhases[postPhases.length - 1];
  if (!postPhase?.variations) return [];
  if (isEqual(prePhase?.variations, postPhase.variations)) return [];

  const preCount = prePhase?.variations?.length ?? 0;
  const postCount = postPhase.variations.length;
  const diff = postCount - preCount;
  if (diff > 0) {
    return [
      {
        label: `+${diff} variation${diff !== 1 ? "s" : ""}`,
        action: "add variation",
      },
    ];
  }
  if (diff < 0) {
    return [
      {
        label: `−${Math.abs(diff)} variation${Math.abs(diff) !== 1 ? "s" : ""}`,
        action: "remove variation",
      },
    ];
  }
  return [{ label: "Edit variation", action: "edit variation" }];
}

export function getExperimentAnalysisBadges(pre: Pre, post: Post): DiffBadge[] {
  const badges: DiffBadge[] = [];

  if (
    !isEqual(pre?.goalMetrics, post.goalMetrics) &&
    post.goalMetrics !== undefined
  ) {
    const preGoals = (pre?.goalMetrics ?? []) as string[];
    const postGoals = post.goalMetrics as string[];
    const diff = postGoals.length - preGoals.length;
    if (diff > 0)
      badges.push({
        label: `+${diff} goal metric${diff !== 1 ? "s" : ""}`,
        action: "add goal metric",
      });
    else if (diff < 0)
      badges.push({
        label: `−${Math.abs(diff)} goal metric${Math.abs(diff) !== 1 ? "s" : ""}`,
        action: "remove goal metric",
      });
    else
      badges.push({ label: "Edit goal metrics", action: "edit goal metrics" });
  }

  const otherMetricsChanged =
    (!isEqual(pre?.secondaryMetrics, post.secondaryMetrics) &&
      post.secondaryMetrics !== undefined) ||
    (!isEqual(pre?.guardrailMetrics, post.guardrailMetrics) &&
      post.guardrailMetrics !== undefined) ||
    (!isEqual(pre?.activationMetric, post.activationMetric) &&
      post.activationMetric !== undefined);
  if (otherMetricsChanged)
    badges.push({ label: "Edit metrics", action: "edit metrics" });

  return badges;
}

export function getExperimentMetadataBadges(pre: Pre, post: Post): DiffBadge[] {
  const badges: DiffBadge[] = [];
  if (!isEqual(pre?.name, post.name) && post.name !== undefined)
    badges.push({ label: "Edit name", action: "edit name" });
  if (!isEqual(pre?.tags, post.tags) && post.tags !== undefined)
    badges.push({ label: "Edit tags", action: "edit tags" });
  if (!isEqual(pre?.project, post.project) && post.project !== undefined)
    badges.push({ label: "Edit project", action: "edit project" });
  if (!isEqual(pre?.owner, post.owner) && post.owner !== undefined)
    badges.push({ label: "Edit owner", action: "edit owner" });
  if (
    !isEqual(pre?.description, post.description) &&
    post.description !== undefined
  )
    badges.push({ label: "Edit description", action: "edit description" });
  return badges;
}
