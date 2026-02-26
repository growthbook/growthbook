import { ReactNode } from "react";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer";
import isEqual from "lodash/isEqual";
import { PiArrowSquareOut } from "react-icons/pi";
import {
  FeatureRule,
  FeaturePrerequisite,
  SavedGroupTargeting,
  ExperimentRefVariation,
  FeatureInterface,
  FeatureEnvironment,
} from "shared/types/feature";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import SavedGroupTargetingDisplay from "@/components/Features/SavedGroupTargetingDisplay";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Badge from "@/ui/Badge";
import { useExperiments } from "@/hooks/useExperiments";
import {
  ChangeField,
  toConditionString,
  GenericFieldChange,
  renderFallback,
  ProjectName,
} from "@/components/AuditHistoryExplorer/DiffRenderUtils";
import { COMPACT_DIFF_STYLES } from "@/components/AuditHistoryExplorer/CompareAuditEventsUtils";
import type { DiffBadge } from "@/components/AuditHistoryExplorer/types";

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
  const isSimple = (v: string | null | undefined): boolean =>
    v == null || (!v.includes("\n") && v.length <= 80);
  if (isSimple(pre) && isSimple(post)) {
    if (label) {
      return (
        <ChangeField
          label={label}
          changed
          oldNode={pre != null ? pre : <em>None</em>}
          newNode={post != null ? post : <em>None</em>}
        />
      );
    }
    return (
      <div className="d-flex align-items-start mb-2">
        <div className="text-danger d-flex align-items-start">
          <div className="text-center mr-2" style={{ width: 16 }}>
            Δ
          </div>
          <div>{pre ?? <em>None</em>}</div>
        </div>
        <div className="font-weight-bold text-success d-flex align-items-start ml-4">
          <div className="text-center mx-2" style={{ width: 16 }}>
            →
          </div>
          <div>{post ?? <em>None</em>}</div>
        </div>
      </div>
    );
  }
  // Multi-line content (e.g. pretty-printed JSON) — use inline diff viewer.
  return (
    <div className="mb-2">
      {label && <div className="font-weight-bold mb-1">{label}</div>}
      <div style={{ maxHeight: 250, overflowY: "auto" }}>
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

// "Rule #3 — Force (value: xyz)" compact descriptor used as a sub-heading.
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
  }
  return (
    <div className="mb-1">
      <Text size="medium" color="text-low">
        Rule #{index} — {getRuleTypeLabel(rule.type)}
      </Text>
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
}: {
  pre: FeatureRule;
  post: FeatureRule;
}) {
  if (isEqual(pre, post)) return null;

  const rows: ReactNode[] = [];
  // id/type/scheduleRules are structural — intentionally suppressed from the render.
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
  ]);

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
            <em>None</em>
          )
        }
        newNode={
          postCond && postCond !== "{}" ? (
            <ConditionDisplay condition={postCond} />
          ) : (
            <em>None</em>
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
            <em>None</em>
          )
        }
        newNode={
          postSG?.length ? (
            <SavedGroupTargetingDisplay savedGroups={postSG} />
          ) : (
            <em>None</em>
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
            <em>None</em>
          )
        }
        newNode={
          normPrereqs(postPrereqs)?.length ? (
            <ConditionDisplay prerequisites={normPrereqs(postPrereqs)} />
          ) : (
            <em>None</em>
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
          pre={pv != null ? formatValue(pv.value) : null}
          post={nv != null ? formatValue(nv.value) : null}
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

  if (!rows.length) return null;
  return <div className="mt-1 ml-3">{rows}</div>;
}

function NewRuleDetails({ rule }: { rule: FeatureRule }) {
  const rows: ReactNode[] = [];

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
        oldNode={<em>None</em>}
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
        oldNode={<em>None</em>}
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
        oldNode={<em>None</em>}
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
        oldNode={<em>None</em>}
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

  if (rule.type === "experiment-ref") {
    rows.push(
      <ChangeField
        key="experimentId"
        label="Experiment"
        changed
        oldNode={<em>None</em>}
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
        oldNode={<em>None</em>}
        newNode="disabled"
      />,
    );
  }

  // id/type/scheduleRules are structural; the other keys are explicitly rendered above.
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
  ]);
  rows.push(
    ...renderFallback(
      null,
      rule as unknown as Record<string, unknown>,
      handled,
    ),
  );

  if (!rows.length) return <></>;
  return <div className="ml-3">{rows}</div>;
}

export function renderFeatureDefaultValue(
  pre: string | null | undefined,
  post: string,
): ReactNode | null {
  if (pre === post) return null;
  const preFormatted = pre != null ? formatValue(pre) : null;
  const postFormatted = formatValue(post);
  return (
    <ValueChangedField
      label="Default value"
      pre={preFormatted}
      post={postFormatted}
    />
  );
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
  const reordered =
    added.length === 0 &&
    removed.length === 0 &&
    modified.length === 0 &&
    !isEqual(preRules, postRules);

  return { added, removed, modified, reordered };
}

export function logBadgeColor(
  action: string,
): "green" | "red" | "amber" | "gray" {
  if (action === "Approved") return "green";
  if (action === "Requested Changes") return "red";
  if (action === "Review Requested") return "amber";
  return "gray";
}

export function featureRuleChangeBadges(
  preRules: FeatureRule[],
  postRules: FeatureRule[],
  env: string,
): DiffBadge[] {
  const { added, removed, modified } = analyzeRuleChanges(preRules, postRules);
  const badges: DiffBadge[] = [];
  if (added.length)
    badges.push({
      label: `Add rule to ${env}${added.length > 1 ? ` ×${added.length}` : ""}`,
      action: "add rule",
    });
  if (removed.length)
    badges.push({
      label: `Delete rule in ${env}${removed.length > 1 ? ` ×${removed.length}` : ""}`,
      action: "delete rule",
    });
  if (modified.length)
    badges.push({
      label: `Edit rule in ${env}${modified.length > 1 ? ` ×${modified.length}` : ""}`,
      action: "edit rule",
    });
  return badges;
}

export function renderFeatureRules(
  preRules: FeatureRule[],
  postRules: FeatureRule[],
): ReactNode | null {
  const { added, removed, modified, reordered } = analyzeRuleChanges(
    preRules,
    postRules,
  );

  const postIndexById = new Map(postRules.map((r, i) => [r.id, i + 1]));
  const preIndexById = new Map(preRules.map((r, i) => [r.id, i + 1]));
  const preById = new Map(preRules.map((r) => [r.id, r]));

  if (reordered) {
    return (
      <div className="mt-1">
        <Text size="medium" color="text-mid">
          Rules reordered
        </Text>
      </div>
    );
  }

  if (!added.length && !removed.length && !modified.length) return null;

  const sections: ReactNode[] = [];

  if (added.length > 0) {
    sections.push(
      <div key="added" className="mb-3">
        <Text size="medium" weight="medium" color="text-mid" as="div" mb="2">
          Added
        </Text>
        {added.map((r) => {
          const idx = postIndexById.get(r.id)!;
          return (
            <div key={r.id} className="mb-3">
              <RuleHeading rule={r} index={idx} />
              <NewRuleDetails rule={r} />
            </div>
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
            <div key={r.id} className="mb-1">
              <RuleHeading rule={r} index={idx} />
            </div>
          );
        })}
      </div>,
    );
  }

  if (modified.length > 0) {
    sections.push(
      <div key="modified" className="mb-2">
        <Text size="medium" weight="medium" color="text-mid" as="div" mb="2">
          Modified
        </Text>
        {modified.map((r) => {
          const prev = preById.get(r.id)!;
          const idx = postIndexById.get(r.id)!;
          return (
            <div key={r.id} className="mb-3">
              <RuleHeading rule={r} index={idx} />
              <RuleFieldDiffs pre={prev} post={r} />
            </div>
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

// Recursively parses embedded JSON strings in a FeatureInterface snapshot.
// Used as `normalizeSnapshot` in the audit diff config.
export function normalizeFeatureSnapshot(
  snapshot: FeatureInterface,
): FeatureInterface {
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

// AuditDiffSection adapters — bridge Partial<FeatureInterface> to the render functions above.

type FeaturePartial = Partial<FeatureInterface> | null;

// defaultValue may already be a parsed object after normalizeSnapshot, so re-stringify.
// Label is omitted here because the section card header already says "Default value".
export function renderFeatureDefaultValueSection(
  pre: FeaturePartial,
  post: Partial<FeatureInterface>,
): ReactNode | null {
  const toStr = (v: unknown): string | null =>
    v == null ? null : typeof v === "string" ? v : JSON.stringify(v);
  const preStr = toStr(pre?.defaultValue);
  const postStr = toStr(post.defaultValue) ?? "";
  if (preStr === postStr) return null;
  return (
    <ValueChangedField
      pre={preStr != null ? formatValue(preStr) : null}
      post={formatValue(postStr)}
    />
  );
}

// Renders per-env enabled toggle and rule diffs.
// Heading is "Production rules" for rules-only; "Production" when toggle is also involved.
// Set suppressCardLabel: true on the section to avoid a redundant outer heading.
export function renderFeatureRulesSection(
  pre: FeaturePartial,
  post: Partial<FeatureInterface>,
): ReactNode | null {
  const preEnvs = (pre?.environmentSettings ?? {}) as Record<
    string,
    FeatureEnvironment
  >;
  const postEnvs = (post.environmentSettings ?? {}) as Record<
    string,
    FeatureEnvironment
  >;
  const allEnvs = [
    ...new Set([...Object.keys(preEnvs), ...Object.keys(postEnvs)]),
  ];
  const sections: ReactNode[] = [];

  for (const env of allEnvs) {
    const preEnv = preEnvs[env];
    const postEnv = postEnvs[env];
    const preEnabled = preEnv?.enabled;
    const postEnabled = postEnv?.enabled;
    const preRules: FeatureRule[] = preEnv?.rules ?? [];
    const postRules: FeatureRule[] = postEnv?.rules ?? [];

    const enabledChanged =
      preEnabled !== undefined &&
      postEnabled !== undefined &&
      preEnabled !== postEnabled;
    const rulesChanged = !isEqual(preRules, postRules);

    if (!enabledChanged && !rulesChanged) continue;

    const rulesRender = rulesChanged
      ? renderFeatureRules(preRules, postRules)
      : null;

    const envCapitalized = env.charAt(0).toUpperCase() + env.slice(1);
    const headingLabel = enabledChanged
      ? envCapitalized
      : `${envCapitalized} rules`;

    sections.push(
      <div key={env} className={sections.length > 0 ? "mt-3" : ""}>
        <Heading as="h6" size="small" color="text-mid" mb="2">
          {headingLabel}
        </Heading>
        {enabledChanged && (
          <ChangeField
            label="Feature enabled"
            changed
            oldNode={preEnabled ? "enabled" : "disabled"}
            newNode={postEnabled ? "enabled" : "disabled"}
          />
        )}
        {rulesRender}
      </div>,
    );
  }

  return sections.length ? <>{sections}</> : null;
}

export function renderFeatureMetadataSection(
  pre: FeaturePartial,
  post: Partial<FeatureInterface>,
): ReactNode | null {
  const rows: ReactNode[] = [];

  if (!isEqual(pre?.archived, post.archived) && post.archived !== undefined) {
    const wasArchived = pre?.archived ?? false;
    rows.push(
      <ChangeField
        key="archived"
        label="Archived"
        changed
        oldNode={wasArchived ? "archived" : "active"}
        newNode={post.archived ? "archived" : "active"}
      />,
    );
  }

  if (!isEqual(pre?.owner, post.owner) && post.owner !== undefined) {
    rows.push(
      <ChangeField
        key="owner"
        label="Owner"
        changed
        oldNode={pre?.owner || <em>None</em>}
        newNode={post.owner}
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
        newNode={<ProjectName id={post.project} />}
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
    post.description !== undefined
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
  if (!isEqual(pre?.archived, post.archived) && post.archived !== undefined) {
    badges.push({
      label: post.archived ? "Archived" : "Unarchived",
      action: "archive",
    });
  }
  if (!isEqual(pre?.owner, post.owner) && post.owner !== undefined) {
    badges.push({ label: "Edit owner", action: "edit owner" });
  }
  if (!isEqual(pre?.project, post.project) && post.project !== undefined) {
    badges.push({ label: "Edit project", action: "edit project" });
  }
  if (!isEqual(pre?.tags, post.tags) && post.tags !== undefined) {
    badges.push({ label: "Edit tags", action: "edit tags" });
  }
  if (
    !isEqual(pre?.description, post.description) &&
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
  const allEnvs = [
    ...new Set([...Object.keys(preEnvs), ...Object.keys(postEnvs)]),
  ];
  return allEnvs.flatMap((env) => {
    const badges: DiffBadge[] = [];
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
    badges.push(
      ...featureRuleChangeBadges(
        preEnvs[env]?.rules ?? [],
        postEnvs[env]?.rules ?? [],
        env,
      ),
    );
    return badges;
  });
}
