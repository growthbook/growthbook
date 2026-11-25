import { ReactNode } from "react";
import type { MessageDescriptor } from "@lingui/core";
import { msg, plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import isEqual from "lodash/isEqual";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  FeaturePrerequisite,
  NamespaceValue,
  SavedGroupTargeting,
} from "shared/types/feature";
import { getMetricLink } from "shared/experiments";
import { calculateNamespaceCoverage, getNamespaceRanges } from "shared/util";
import { getValidDate } from "shared/dates";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import SavedGroupTargetingDisplay from "@/components/Features/SavedGroupTargetingDisplay";
import { coveragePercentFormatter, formatTrafficSplit } from "@/services/utils";
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

// Phase dates bound warehouse queries, so they read in UTC like the forms that set them.
const phaseDatetime = (d: string | Date) =>
  `${getValidDate(d).toISOString().replace("T", " ").slice(0, 19)} UTC`;

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

function NoneLabel() {
  return (
    <em>
      <Trans>None</Trans>
    </em>
  );
}

function UnsetLabel() {
  return (
    <em>
      <Trans>unset</Trans>
    </em>
  );
}

// A field label, numbered by phase when the experiment has several.
function PhaseFieldLabel({
  label,
  phase,
}: {
  label: MessageDescriptor;
  phase: number | null;
}) {
  const { i18n } = useLingui();
  const labelText = i18n._(label);
  if (phase === null) return <>{labelText}</>;
  return (
    <Trans>
      {labelText} (Phase {phase})
    </Trans>
  );
}

// TextChangedField takes its label as a string, so resolve it in a component.
function TranslatedTextChangedField({
  label,
  pre,
  post,
}: {
  label: MessageDescriptor;
  pre: string | null | undefined;
  post: string | null | undefined;
}) {
  const { i18n } = useLingui();
  return <TextChangedField label={i18n._(label)} pre={pre} post={post} />;
}

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
  label: MessageDescriptor;
  preArr?: string[] | null;
  postArr?: string[] | null;
}) {
  const { i18n } = useLingui();
  const a = preArr ?? [];
  const b = postArr ?? [];
  const added = b.filter((id) => !a.includes(id));
  const removed = a.filter((id) => !b.includes(id));
  if (!added.length && !removed.length) return null;

  return (
    <div className="mb-2">
      <div className="mb-1">
        <Text size="md" weight="medium" color="text-mid">
          {i18n._(label)}
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
  namespace?: NamespaceValue | null;
  seed?: string;
};

/**
 * Collapse a namespace to a shape-stable form for comparison. Without this,
 * `isEqual` flags false positives whenever one side has the legacy `range`
 * tuple and the other has multiRange `ranges` — or when derived fields like
 * `format`/`hashAttribute` are present on only one side.
 */
function normalizeNsForDiff(ns: PhaseTargeting["namespace"]) {
  if (!ns?.enabled) return null;
  return { enabled: true, name: ns.name, ranges: getNamespaceRanges(ns) };
}

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
    const phase = multi ? i + 1 : null;

    // ── Attribute targeting (condition) ──────────────────────────────────────
    const condChanged = !isEqual(preP.condition, postP.condition);
    if (condChanged) {
      const preStr = toConditionString(preP.condition);
      const postStr = toConditionString(postP.condition);
      sections.push(
        <ChangeField
          key={`cond-${i}`}
          label={
            <PhaseFieldLabel label={msg`Attribute targeting`} phase={phase} />
          }
          changed
          oldNode={
            preStr && preStr !== "{}" ? (
              <ConditionDisplay condition={preStr} />
            ) : (
              <NoneLabel />
            )
          }
          newNode={
            postStr && postStr !== "{}" ? (
              <ConditionDisplay condition={postStr} />
            ) : (
              <NoneLabel />
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
          label={
            <PhaseFieldLabel label={msg`Saved group targeting`} phase={phase} />
          }
          changed
          oldNode={
            preP.savedGroups?.length ? (
              <SavedGroupTargetingDisplay savedGroups={preP.savedGroups} />
            ) : (
              <NoneLabel />
            )
          }
          newNode={
            postP.savedGroups?.length ? (
              <SavedGroupTargetingDisplay savedGroups={postP.savedGroups} />
            ) : (
              <NoneLabel />
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
          label={
            <PhaseFieldLabel
              label={msg`Prerequisite targeting`}
              phase={phase}
            />
          }
          changed
          oldNode={
            prePrereqs?.length ? (
              <ConditionDisplay prerequisites={prePrereqs} />
            ) : (
              <NoneLabel />
            )
          }
          newNode={
            postPrereqs?.length ? (
              <ConditionDisplay prerequisites={postPrereqs} />
            ) : (
              <NoneLabel />
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
      const fmtTraffic = (p: PhaseTargeting): ReactNode => {
        const cov =
          p.coverage !== undefined
            ? coveragePercentFormatter.format(p.coverage)
            : "—";
        if (!p.variationWeights?.length) return <Trans>{cov} included</Trans>;
        const split = formatTrafficSplit(p.variationWeights, 0);
        return (
          <Trans>
            {cov} included, {split} split
          </Trans>
        );
      };
      sections.push(
        <ChangeField
          key={`traffic-${i}`}
          label={<PhaseFieldLabel label={msg`Traffic`} phase={phase} />}
          changed
          oldNode={fmtTraffic(preP)}
          newNode={fmtTraffic(postP)}
        />,
      );
    }

    // ── Namespace ─────────────────────────────────────────────────────────────
    const nsChanged = !isEqual(
      normalizeNsForDiff(preP.namespace),
      normalizeNsForDiff(postP.namespace),
    );
    if (nsChanged) {
      const fmtNs = (ns: PhaseTargeting["namespace"]): ReactNode =>
        ns?.enabled ? (
          `${ns.name} (${percentFormatter.format(calculateNamespaceCoverage(ns))})`
        ) : (
          <Trans>Global (all users)</Trans>
        );
      sections.push(
        <ChangeField
          key={`ns-${i}`}
          label={<PhaseFieldLabel label={msg`Namespace`} phase={phase} />}
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
          label={<PhaseFieldLabel label={msg`Hash seed`} phase={phase} />}
          changed
          oldNode={preP.seed ?? <NoneLabel />}
          newNode={postP.seed || <NoneLabel />}
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
      v === undefined ? (
        <UnsetLabel />
      ) : v ? (
        <Trans>disabled</Trans>
      ) : (
        <Trans>enabled</Trans>
      );
    rows.push(
      <ChangeField
        key="sticky"
        label={<Trans>Sticky bucketing</Trans>}
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

// "Phase info" — phases: dateStarted, dateEnded, name, reason.
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
    const phase = multi ? i + 1 : null;

    if (!isEqual(preP.dateStarted, postP.dateStarted) && postP.dateStarted) {
      sections.push(
        <ChangeField
          key={`start-${i}`}
          label={<PhaseFieldLabel label={msg`Start date`} phase={phase} />}
          changed
          oldNode={
            preP.dateStarted ? phaseDatetime(preP.dateStarted) : <NoneLabel />
          }
          newNode={phaseDatetime(postP.dateStarted)}
        />,
      );
    }

    if (!isEqual(preP.dateEnded, postP.dateEnded)) {
      sections.push(
        <ChangeField
          key={`end-${i}`}
          label={<PhaseFieldLabel label={msg`End date`} phase={phase} />}
          changed
          oldNode={
            preP.dateEnded ? phaseDatetime(preP.dateEnded) : <NoneLabel />
          }
          newNode={
            postP.dateEnded ? phaseDatetime(postP.dateEnded) : <NoneLabel />
          }
        />,
      );
    }

    if (!isEqual(preP.name, postP.name) && postP.name) {
      sections.push(
        <ChangeField
          key={`name-${i}`}
          label={<PhaseFieldLabel label={msg`Phase name`} phase={phase} />}
          changed
          oldNode={preP.name ?? <NoneLabel />}
          newNode={postP.name}
        />,
      );
    }

    if (!isEqual(preP.reason, postP.reason) && postP.reason) {
      sections.push(
        <ChangeField
          key={`reason-${i}`}
          label={<PhaseFieldLabel label={msg`Stop reason`} phase={phase} />}
          changed
          oldNode={preP.reason ?? <NoneLabel />}
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
        v ? phaseDatetime(v as string | Date) : <NoneLabel />;
      sections.push(
        <ChangeField
          key={`lookback-${i}`}
          label={<PhaseFieldLabel label={msg`Lookback start`} phase={phase} />}
          changed
          oldNode={fmt(preD)}
          newNode={fmt(d)}
        />,
      );
    }
  });

  return sections.length ? <div className="mt-1">{sections}</div> : null;
}

// "Variations" — list with names and keys; highlights added, removed, renamed.
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
          label={<Trans>Variation {i}</Trans>}
          changed
          oldNode={
            preV ? (
              `${preV.name} (${preV.key})`
            ) : (
              <em>
                <Trans>new</Trans>
              </em>
            )
          }
          newNode={`${v.name} (${v.key})`}
        />,
      );
    }
  });

  preVars.slice(postVars.length).forEach((v, i) => {
    const variationNumber = postVars.length + i;
    rows.push(
      <ChangeField
        key={`v-rm-${i}`}
        label={<Trans>Variation {variationNumber}</Trans>}
        changed
        oldNode={`${v.name} (${v.key})`}
        newNode={
          <em>
            <Trans>removed</Trans>
          </em>
        }
      />,
    );
  });

  return rows.length ? <div className="mt-1">{rows}</div> : null;
}

function ActivationMetricName({ id }: { id: string | undefined | null }) {
  const { getExperimentMetricById } = useDefinitions();
  if (!id) return <UnsetLabel />;
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
        label={msg`Goal metrics`}
        preArr={pre?.goalMetrics}
        postArr={post.goalMetrics}
      />,
    );
  }

  if (metricsChanged(pre?.secondaryMetrics, post.secondaryMetrics)) {
    rows.push(
      <MetricDiff
        key="sec"
        label={msg`Secondary metrics`}
        preArr={pre?.secondaryMetrics}
        postArr={post.secondaryMetrics}
      />,
    );
  }

  if (metricsChanged(pre?.guardrailMetrics, post.guardrailMetrics)) {
    rows.push(
      <MetricDiff
        key="gr"
        label={msg`Guardrail metrics`}
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
        label={<Trans>Activation metric</Trans>}
        changed
        oldNode={<ActivationMetricName id={pre?.activationMetric} />}
        newNode={<ActivationMetricName id={post.activationMetric} />}
      />,
    );
  }

  // ── Bandit schedule / burn-in ──────────────────────────────────────────────
  const fmtBandit = (val: number | undefined, unit: string | undefined) =>
    val !== undefined ? `${val} ${unit ?? ""}`.trim() : <UnsetLabel />;

  const banditBurnChanged =
    !isEqual(pre?.banditBurnInValue, post.banditBurnInValue) ||
    !isEqual(pre?.banditBurnInUnit, post.banditBurnInUnit);
  if (banditBurnChanged && post.banditBurnInValue !== undefined) {
    rows.push(
      <ChangeField
        key="banditBurnIn"
        label={<Trans>Bandit burn-in period</Trans>}
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
        label={<Trans>Bandit schedule</Trans>}
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
      <TranslatedTextChangedField
        key="queryFilter"
        label={msg`Query filter`}
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
            <Text size="md" weight="medium" color="text-mid">
              <Trans>Tags</Trans>
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
      <TranslatedTextChangedField
        key="hyp"
        label={msg`Hypothesis`}
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
      <TranslatedTextChangedField
        key="desc"
        label={msg`Description`}
        pre={pre?.description}
        post={post.description}
      />,
    );
  }

  if (!isEqual(pre?.project, post.project) && post.project !== undefined) {
    rows.push(
      <ChangeField
        key="project"
        label={<Trans>Project</Trans>}
        changed
        oldNode={
          pre?.project ? <ProjectName id={pre.project} /> : <NoneLabel />
        }
        newNode={
          post.project ? <ProjectName id={post.project} /> : <NoneLabel />
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
  return [
    {
      label: "Edit targeting",
      action: "edit targeting",
      displayLabel: msg`Edit targeting`,
    },
  ];
}

export function getExperimentPhaseInfoBadges(
  pre: Pre,
  post: Post,
): DiffBadge[] {
  const prePhases = (pre?.phases ?? []) as { dateEnded?: string | null }[];
  const postPhases = (post.phases ?? []) as { dateEnded?: string | null }[];
  if (postPhases.length > prePhases.length)
    return [
      { label: "New phase", action: "new phase", displayLabel: msg`New phase` },
    ];
  if (postPhases.length < prePhases.length)
    return [
      {
        label: "Phase deleted",
        action: "delete phase",
        displayLabel: msg`Phase deleted`,
      },
    ];
  const wasEnded = postPhases.some(
    (p, i) => p.dateEnded && !prePhases[i]?.dateEnded,
  );
  if (wasEnded)
    return [
      {
        label: "Phase ended",
        action: "end phase",
        displayLabel: msg`Phase ended`,
      },
    ];
  return [
    {
      label: "Edit phase",
      action: "edit phase",
      displayLabel: msg`Edit phase`,
    },
  ];
}

export function getExperimentVariationsBadges(
  pre: Pre,
  post: Post,
): DiffBadge[] {
  if (post.variations === undefined) return [];
  const preCount = pre?.variations?.length ?? 0;
  const postCount = (post.variations as unknown[]).length;
  const diff = postCount - preCount;
  const removedCount = Math.abs(diff);
  if (diff > 0)
    return [
      {
        label: `+${diff} variation${diff !== 1 ? "s" : ""}`,
        action: "add variation",
        displayLabel: msg`${plural(diff, {
          one: "+# variation",
          other: "+# variations",
        })}`,
      },
    ];
  if (diff < 0)
    return [
      {
        label: `−${Math.abs(diff)} variation${Math.abs(diff) !== 1 ? "s" : ""}`,
        action: "remove variation",
        displayLabel: msg`${plural(removedCount, {
          one: "−# variation",
          other: "−# variations",
        })}`,
      },
    ];
  return [
    {
      label: "Edit variation",
      action: "edit variation",
      displayLabel: msg`Edit variation`,
    },
  ];
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
    const removedCount = Math.abs(diff);
    if (diff > 0)
      badges.push({
        label: `+${diff} goal metric${diff !== 1 ? "s" : ""}`,
        action: "add goal metric",
        displayLabel: msg`${plural(diff, {
          one: "+# goal metric",
          other: "+# goal metrics",
        })}`,
      });
    else if (diff < 0)
      badges.push({
        label: `−${Math.abs(diff)} goal metric${Math.abs(diff) !== 1 ? "s" : ""}`,
        action: "remove goal metric",
        displayLabel: msg`${plural(removedCount, {
          one: "−# goal metric",
          other: "−# goal metrics",
        })}`,
      });
    else
      badges.push({
        label: "Edit goal metrics",
        action: "edit goal metrics",
        displayLabel: msg`Edit goal metrics`,
      });
  }

  const otherMetricsChanged =
    (!isEqual(pre?.secondaryMetrics, post.secondaryMetrics) &&
      post.secondaryMetrics !== undefined) ||
    (!isEqual(pre?.guardrailMetrics, post.guardrailMetrics) &&
      post.guardrailMetrics !== undefined) ||
    (!isEqual(pre?.activationMetric, post.activationMetric) &&
      post.activationMetric !== undefined);
  if (otherMetricsChanged)
    badges.push({
      label: "Edit metrics",
      action: "edit metrics",
      displayLabel: msg`Edit metrics`,
    });

  return badges;
}

export function getExperimentMetadataBadges(pre: Pre, post: Post): DiffBadge[] {
  const badges: DiffBadge[] = [];
  if (!isEqual(pre?.name, post.name) && post.name !== undefined)
    badges.push({
      label: "Edit name",
      action: "edit name",
      displayLabel: msg`Edit name`,
    });
  if (!isEqual(pre?.tags, post.tags) && post.tags !== undefined)
    badges.push({
      label: "Edit tags",
      action: "edit tags",
      displayLabel: msg`Edit tags`,
    });
  if (!isEqual(pre?.project, post.project) && post.project !== undefined)
    badges.push({
      label: "Edit project",
      action: "edit project",
      displayLabel: msg`Edit project`,
    });
  if (!isEqual(pre?.owner, post.owner) && post.owner !== undefined)
    badges.push({
      label: "Edit owner",
      action: "edit owner",
      displayLabel: msg`Edit owner`,
    });
  if (
    !isEqual(pre?.description, post.description) &&
    post.description !== undefined
  )
    badges.push({
      label: "Edit description",
      action: "edit description",
      displayLabel: msg`Edit description`,
    });
  return badges;
}
