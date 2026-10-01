import type { FeatureUsageDimension } from "shared/types/feature";
import {
  FEATURE_USAGE_BUCKET_SECONDS,
  getFeatureUsageWindowStart,
} from "shared/featureUsageBuckets";
import {
  FeatureRevisionInterface,
  MinimalFeatureRevisionInterface,
} from "shared/types/feature-revision";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { FeatureInterface } from "shared/types/feature";
import {
  CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useForm } from "react-hook-form";
import { OrganizationSettings } from "shared/types/organization";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import {
  isProjectListValidForProject,
  isManagedWarehouseUnavailable,
  getActiveFeatureUsageQuery,
  stemRuleId,
} from "shared/util";
import { useRouter } from "next/router";
import {
  FeatureEvalDiagnosticsFilterColumn,
  FeatureEvalDiagnosticsQueryResponseRows,
  FeatureUsageLookback,
} from "shared/types/integrations";
import type { RowFilter } from "shared/types/fact-table";
import { ago, date, getValidDate } from "shared/dates";
import { QueryStatistics } from "shared/types/query";
import { Box, Flex, Skeleton } from "@radix-ui/themes";
import clsx from "clsx";
import {
  PiArrowClockwiseBold,
  PiCaretRight,
  PiChartBarBold,
  PiCheck,
  PiClockBold,
  PiCopy,
  PiXBold,
} from "react-icons/pi";
import { format } from "date-fns";
import { useDefinitions } from "@/services/DefinitionsContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useAuth } from "@/services/auth";
import LinkButton from "@/ui/LinkButton";
import { useAddComputedFields, useSearch } from "@/services/search";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import Frame from "@/ui/Frame";
import Link from "@/ui/Link";
import EmptyState from "@/components/EmptyState";
import ManagedWarehouseNoEventsCallout from "@/components/ManagedWarehouse/ManagedWarehouseNoEventsCallout";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import StreamSearchField from "@/components/Diagnostics/StreamSearchField";
import TruncatedCell from "@/components/Diagnostics/TruncatedCell";
import StreamPagination, {
  STREAM_DEFAULT_ROWS_PER_PAGE,
} from "@/components/Diagnostics/StreamPagination";
import streamTableStyles from "@/components/Diagnostics/StreamTable.module.scss";
import DisplayTestQueryResults from "@/components/Settings/DisplayTestQueryResults";
import { useFeatureUsage } from "@/components/Features/FeatureUsageGraph";
import { useEnvironments } from "@/services/features";
import FeatureDiagnosticsControlBar, {
  LOOKBACK_PRESETS,
  type EnvironmentOption,
} from "@/components/Features/FeatureDiagnosticsControlBar";
import Heading from "@/ui/Heading";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import DetailDrawer, {
  DetailEmpty,
  DetailRow,
  DetailSectionLabel,
  TypedValue,
} from "@/components/Diagnostics/DetailDrawer";
import { DocLink } from "@/components/DocLink";
import DataCardHeader from "@/components/Diagnostics/DataCardHeader";
import FeatureEvaluationsCard from "@/components/Features/FeatureEvaluationsCard";
import styles from "./FeatureDiagnostics.module.scss";
import { dummyUserForRow } from "./featureDiagnosticsDummyUsers";
import {
  buildRuleCellResolver,
  RuleCellReference,
} from "./featureEvaluationsBreakdown";
import {
  buildVariationLabeler,
  formatFullStreamTimestamp,
  groupAttributesByTargeting,
  targetingAttributeKeys,
  MANAGED_STREAM_TABLE_COLUMNS,
  planStreamColumnWidths,
  STREAM_COLUMN_EXTRA_PX,
  managedStreamColumnLabel,
  matchesUsageRowFilter,
  toUsageRowFilters,
  planStreamTimestamps,
  ruleAbsenceNote,
  streamColumnLabel,
} from "./featureDiagnosticsStream";

type FeatureEvaluationDiagnosticsQueryResults = {
  rows?: FeatureEvalDiagnosticsQueryResponseRows;
  statistics?: QueryStatistics;
};

// Helper function to format a value for display
const formatDisplayValue = (value: unknown): string => {
  if (value === null) {
    return "null";
  } else if (value === undefined) {
    return "undefined";
  } else if (typeof value === "boolean") {
    return String(value);
  } else if (typeof value === "object") {
    return JSON.stringify(value);
  } else {
    return String(value);
  }
};

type DiagnosticsRow = FeatureEvalDiagnosticsQueryResponseRows[number] & {
  id: string;
};

const DUMMY_ROW_COUNT = 60;
/**
 * Every 5th row goes to an environment other than the lead one, so the lead
 * reads as the majority it is in real traffic and the rest still appear.
 */
const DUMMY_MINORITY_EVERY = 5;

/**
 * One template per distinct way this flag can evaluate. Source, value, ruleId
 * and variationId travel together rather than being sampled independently — a
 * row reading `source: defaultValue` beside another rule's value would be a
 * shape the SDK never emits, and this table exists to debug exactly that
 * correlation.
 *
 * Derived the same way as getDummyData() in FeatureUsageGraph.tsx, including
 * the stem-stripped rule ids that match real SDK telemetry.
 */
function getDummyRowTemplates(feature: FeatureInterface): Array<{
  value: string;
  source: string;
  ruleId: string;
  variationId: string;
}> {
  // Always present, and the whole list for a flag with no rules — which is the
  // case this must not render empty for.
  const templates = [
    {
      value: feature.defaultValue,
      source: "defaultValue",
      ruleId: "$default",
      variationId: "",
    },
  ];

  (feature.rules ?? []).forEach((rule) => {
    const ruleId = rule.id ? stemRuleId(rule.id) : "";
    if (rule.type === "force") {
      templates.push({
        value: rule.value,
        source: "force",
        ruleId,
        variationId: "",
      });
    } else if (rule.type === "rollout") {
      templates.push({
        value: rule.value,
        source: "rollout",
        ruleId,
        variationId: "",
      });
    } else if (rule.type === "experiment-ref") {
      rule.variations.forEach((v, i) => {
        templates.push({
          value: v.value,
          source: "experiment",
          ruleId,
          variationId: String(i),
        });
      });
    }
  });

  return templates;
}

/**
 * Column order for the evaluation stream, left to right after Timestamp.
 *
 * Follows the Log Stream widget's logic: when -> what happened -> where ->
 * details.
 *
 *  - `value` is the analog of Log Stream's Event column. It is the outcome, the
 *    thing people scan for, and it is the chart's default group-by, so the eye
 *    carries the same dimension from the chart into the table.
 *  - `source`, `ruleId` and `variationId` are one causal chain — how it was
 *    decided, which rule matched, which variation was served. Nothing may be
 *    inserted between them.
 *  - `environment` sits last because it is now the page scope. With one
 *    environment in the scope chip every row reads the same, and a constant
 *    column in second position is wasted prominence; it only carries
 *    information when several are selected.
 *
 * Keys not listed keep their arrival order at the end, so a new column from the
 * warehouse still appears rather than being silently dropped.
 */
/**
 * The managed warehouse's stream columns, from its fixed query
 * (ClickHouse#getFeatureEvalDiagnosticsQuery). Used only before a first run,
 * when there are no rows yet to read the columns from.
 */
const MANAGED_STREAM_COLUMNS = [
  "timestamp",
  "feature_key",
  "environment",
  "value",
  "source",
  "ruleId",
  "variationId",
];

/**
 * The stream column(s) each grouping can filter by, first match wins. The rule
 * column is `ruleId` on the managed warehouse and `rule_id` in the event
 * forwarder templates. Mirrors the server's closed set.
 */
const STREAM_FILTER_COLUMNS: Record<
  FeatureUsageDimension,
  FeatureEvalDiagnosticsFilterColumn[]
> = {
  value: ["value"],
  source: ["source"],
  environment: ["environment"],
  ruleId: ["ruleId", "rule_id"],
};

/** The series chip's prefix, matching the group-by control's labels. */
const GROUP_BY_LABELS: Record<FeatureUsageDimension, string> = {
  value: "Value",
  ruleId: "Rule",
  source: "Source",
  environment: "Environment",
};

const COLUMN_ORDER = [
  "value",
  "source",
  "ruleId",
  "variationId",
  "environment",
];

/**
 * The chip's text: the bucket's bounds, plus the group if a segment was
 * clicked rather than the column background.
 *
 * Seconds appear only when the buckets are sub-minute — at 30s a chip reading
 * "16:52–16:52" would name the same minute twice and look like a bug.
 */
function describeSelection(
  selection: { start: number; end: number; groupValue?: string },
  bucketMs: number,
): string {
  const withSeconds = bucketMs < 60_000;
  const time = (t: number) =>
    format(new Date(t), withSeconds ? "HH:mm:ss" : "HH:mm");
  // The date leads, once: on a 7-day window "14:20–14:40" names no particular
  // day, and repeating the date on both ends would say the same thing twice
  // for a bucket that cannot span one.
  const range = `${format(new Date(selection.start), "MMM d")}, ${time(
    selection.start,
  )} – ${time(selection.end)}`;
  return selection.groupValue === undefined
    ? range
    : `${range} · ${selection.groupValue}`;
}

/**
 * Label for a revision marker.
 *
 * `rev 13 · 100%` only when there is genuinely one number to print: exactly one
 * rule differs from the previous published revision, and that rule carries a
 * coverage. Everything else is `rev 13`.
 *
 * The restraint is the point. A revision can change several rules at once, or
 * set different coverage per environment, and in those cases no single
 * percentage is true — picking the first rule or averaging them would put a
 * number on the chart that describes nothing, which on a diagnostics surface is
 * worse than saying less.
 *
 * `fullRevisions` is the five most recent (FeatureRevisionModel's `.limit(5)`),
 * so a marker older than that has no rules to compare and takes the bare form.
 * That is a data limit, not a judgement about the revision.
 */
function buildRevisionLabel(
  fullRevisions: FeatureRevisionInterface[] | undefined,
): (version: number) => string {
  const byVersion = new Map(
    (fullRevisions ?? []).map((r) => [r.version, r] as const),
  );

  return (version: number) => {
    const bare = `rev ${version}`;
    const current = byVersion.get(version);
    const previous = byVersion.get(version - 1);
    if (!current || !previous) return bare;

    const rules = Array.isArray(current.rules) ? current.rules : [];
    const previousById = new Map(
      (Array.isArray(previous.rules) ? previous.rules : []).map(
        (r) => [r.id, r] as const,
      ),
    );

    // Compared by serialised value rather than by identity: a rule object is
    // rebuilt on every save, so reference equality would report every rule as
    // changed on every revision.
    const changed = rules.filter(
      (r) => JSON.stringify(previousById.get(r.id)) !== JSON.stringify(r),
    );
    if (changed.length !== 1) return bare;

    const coverage = (changed[0] as { coverage?: number }).coverage;
    if (typeof coverage !== "number") return bare;

    // Stored 0-1. Trailing zeros dropped so a full rollout reads "100%" rather
    // than "100.0%".
    return `${bare} · ${parseFloat((coverage * 100).toFixed(1))}%`;
  };
}

/**
 * The width `value` had before Timestamp grew: an equal share of what was left
 * over from the old 150px timestamp, across the five non-timestamp columns.
 *
 * Pinned as a calc() rather than a percentage or a px so it holds at any card
 * width — the table is fluid, so a fixed number would only be correct at one
 * size. The four columns that remain unsized are the ones that give up the
 * difference.
 */
const VALUE_COLUMN_WIDTH = "calc((100% - 150px) / 5)";

/**
 * Where the header bar comes to rest, and so the offset the pinned-state
 * observer measures against. Must match `top` on .stickyHeader — see the note
 * there for why it is 95 and what else that number is tied to.
 */
const STICKY_HEADER_TOP_PX = 95;

/**
 * Rows in the managed-warehouse shape from ClickHouse's
 * getFeatureEvalDiagnosticsQuery. Every managed column must be present: the
 * table shows the managed warehouse's fixed column set for these rows, so a key
 * missing here would render as an empty column.
 *
 * Templates are assigned round-robin rather than sampled, which guarantees
 * every source, value and rule id is visible in the table — a random draw can
 * miss one entirely on a flag with many rules.
 */
/**
 * FAKE DATA, shaped to respond to the page's controls the way real rows do:
 * environments are the flag's own (the lead one "production" when the flag
 * has it), and timestamps spread across the selected time window. Without
 * this the environment chip and time range visibly did nothing to the
 * stream in dummy mode — the rows were hard-coded to production/staging over
 * a fixed four hours.
 */
function getDummyDiagnosticsRows(
  feature: FeatureInterface,
  environmentIds: string[],
  lookback: FeatureUsageLookback,
): DiagnosticsRow[] {
  const templates = getDummyRowTemplates(feature);
  // Anchored at render so the newest row always reads as "just now" rather than
  // whenever this code was written.
  const now = Date.now();
  const windowMs =
    now - getFeatureUsageWindowStart(lookback, new Date(now)).getTime();
  const step = windowMs / DUMMY_ROW_COUNT;
  const envs = environmentIds.length ? environmentIds : ["production"];
  const lead = envs.includes("production") ? "production" : envs[0];
  const others = envs.filter((e) => e !== lead);

  return Array.from({ length: DUMMY_ROW_COUNT }, (_, i) => {
    const template = templates[i % templates.length];
    return {
      // Descending, so the table's default sort has nothing to undo.
      timestamp: new Date(now - i * step).toISOString(),
      feature_key: feature.id,
      environment:
        others.length && i % DUMMY_MINORITY_EVERY === DUMMY_MINORITY_EVERY - 1
          ? others[Math.floor(i / DUMMY_MINORITY_EVERY) % others.length]
          : lead,
      value: template.value,
      source: template.source,
      ruleId: template.ruleId,
      variationId: template.variationId,
      // Fake identity and attributes — see featureDiagnosticsDummyUsers.
      ...dummyUserForRow(i),
      id: String(i),
    };
  });
}

function getDatasourceInitialFormValue(
  datasources: DataSourceInterfaceWithParams[],
  settings: OrganizationSettings,
  project?: string,
): { datasourceId: string } {
  const validDatasources = datasources.filter((d) =>
    isProjectListValidForProject(d.projects, project),
  );

  if (!validDatasources.length) return { datasourceId: "" };

  // Default to the first datasource with a feature usage query or managed warehouse.
  // If none found, fall back to the org default datasource.
  const initialId =
    validDatasources.find(
      (d) =>
        (d.type === "growthbook_clickhouse" &&
          !isManagedWarehouseUnavailable(d)) ||
        getActiveFeatureUsageQuery(d.settings?.queries?.featureUsage),
    )?.id || settings.defaultDataSource;

  const initialDatasource =
    (initialId && validDatasources.find((d) => d.id === initialId)) ||
    validDatasources[0];

  return {
    datasourceId: initialDatasource.id,
  };
}

const DEFAULT_VALUE_TEXT = "Default value";
const NO_RULE_TEXT = "Served without a rule";

/** What the Rule cell renders, as text — for sizing the column. */
function ruleCellText(reference: RuleCellReference, rawId: unknown): string {
  switch (reference.kind) {
    case "rule":
      // The swatch and its gap take ~2ch.
      return `  ${reference.label}`;
    case "default":
      return `  ${DEFAULT_VALUE_TEXT}`;
    case "none":
      return NO_RULE_TEXT;
    case "deleted":
      // Swatch, then the id, then the "deleted" tag (~9ch).
      return `  ${String(rawId ?? "")}         `;
  }
}

/**
 * The Rule cell as a reference rather than raw text: the rule's chart colour
 * and name. No list number: a stream row is history, and "rule 2" today may
 * be a different rule from the one that served the row. The raw id stays in
 * the title on every rule, for cross-referencing the warehouse.
 */
function RuleCell({
  rawId,
  reference,
}: {
  rawId: string;
  reference: RuleCellReference;
}) {
  if (reference.kind === "default") {
    return (
      <span
        className={clsx(styles.ruleCell, styles.ruleCellMuted)}
        title={ruleAbsenceNote(rawId) ?? undefined}
      >
        <span className={clsx(styles.ruleSwatch, styles.ruleSwatchDefault)} />
        {DEFAULT_VALUE_TEXT}
      </span>
    );
  }
  if (reference.kind === "none") {
    return (
      <span
        className={styles.ruleCellMuted}
        title={ruleAbsenceNote(rawId) ?? undefined}
      >
        {NO_RULE_TEXT}
      </span>
    );
  }
  if (reference.kind === "deleted") {
    // The id rather than a guess: it is the only true thing left about it.
    return (
      <span className={styles.ruleCell} title={rawId}>
        <span className={clsx(styles.ruleSwatch, styles.ruleSwatchDeleted)} />
        <span className={clsx(styles.ruleCellText, styles.ruleCellMuted)}>
          <TruncatedCell value={rawId} truncate="middle" />
        </span>
        <Badge label="deleted" color="gray" variant="soft" size="xs" />
      </span>
    );
  }
  return (
    <span className={styles.ruleCell} title={rawId}>
      <span
        className={styles.ruleSwatch}
        style={{ backgroundColor: reference.color }}
      />
      <span className={styles.ruleCellText}>
        <TruncatedCell value={reference.label} truncate="middle" />
      </span>
    </span>
  );
}

export const EVALUATION_DRAWER_ID = "evaluation-detail-drawer";

/** A non-empty string field of a raw row, or null. */
function rowString(row: Record<string, unknown>, key: string): string | null {
  const v = row[key];
  return typeof v === "string" && v !== "" ? v : null;
}

/**
 * The row's JSON as the drawer shows it and copies it: the row as fetched,
 * minus the positional id the table adds for its own keys. One function for
 * both, so the Raw block and its Copy action cannot become two shapes.
 */
function rowJson(row: Record<string, unknown>): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(row).filter(([key]) => key !== "id")),
    null,
    2,
  );
}

/** A row's attributes when it carries any; null for absent or {}. */
function rowAttributes(
  row: Record<string, unknown>,
): [string, unknown][] | null {
  const a = row.attributes;
  if (!a || typeof a !== "object" || Array.isArray(a)) return null;
  const entries = Object.entries(a as Record<string, unknown>);
  return entries.length ? entries : null;
}

/**
 * An attribute value. Arrays get one chip per entry, wrapping — a seven-entry
 * tag list is not readable as JSON on one line. Everything else is the shared
 * TypedValue, so strings keep their quotes and scalars their tint.
 */
function AttributeValue({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    return (
      <span className={styles.drawerChips}>
        {value.map((entry, i) => (
          <span
            key={i}
            className={clsx(
              styles.drawerChip,
              typeof entry !== "string" && styles.drawerChipScalar,
            )}
            title={String(entry)}
          >
            {String(entry)}
          </span>
        ))}
      </span>
    );
  }
  return <TypedValue value={value} />;
}

/**
 * The header is the row's identity: the most identifying field available
 * leads. With a user id, that is line 1 and the timestamp is line 2; without
 * one — every row of real managed data today — the timestamp leads alone.
 * The value is never the title: it is unbounded, and a JSON flag would put a
 * paragraph in a fixed-size slot. It lives in the Evaluation section.
 */
function EvaluationHeader({ row }: { row: Record<string, unknown> }) {
  const unitId = rowString(row, "unit_id");
  const timestamp = formatFullStreamTimestamp(row.timestamp);
  const lead = unitId ?? timestamp;
  return (
    <>
      <Flex className={styles.drawerTitleRow}>
        <div className={styles.drawerTitle} title={lead}>
          {lead}
        </div>
      </Flex>
      {unitId && <div className={styles.drawerSubtitle}>{timestamp}</div>}
    </>
  );
}

/**
 * A JSON object or array, pretty-printed; null for anything else (a boolean,
 * number or plain string value renders as it is).
 */
function prettyJson(value: string): string | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object"
      ? JSON.stringify(parsed, null, 2)
      : null;
  } catch {
    return null;
  }
}

function EvaluationBody({
  row,
  ruleReference,
  variationText,
  onCopy,
  copied,
  targetingKeys,
}: {
  row: Record<string, unknown>;
  ruleReference: RuleCellReference;
  variationText: string | null;
  /** Copies what the Raw block shows. */
  onCopy: () => void;
  copied: boolean;
  /** Attribute keys the flag's current conditions reference, in rule order. */
  targetingKeys: string[];
}) {
  const attributes = rowAttributes(row);
  // Per open: the body is keyed by row, so this starts expanded every time.
  const [otherOpen, setOtherOpen] = useState(true);
  // Split only when a condition references something; otherwise the flat list.
  const groups = attributes
    ? groupAttributesByTargeting(attributes, targetingKeys)
    : null;
  const attributeRow = ([key, value]: [string, unknown]) => (
    <DetailRow key={key} label={key}>
      <AttributeValue value={value} />
    </DetailRow>
  );
  return (
    <>
      {/* Table columns first, in column order (left to right becomes top to
          bottom), except Environment, the qualifier on all of it, which closes
          the section. Source is no longer a column, so this is the one place
          it is shown. */}
      <DetailSectionLabel variant="heading">Evaluation</DetailSectionLabel>
      <DetailRow label="Value">
        {/* Wraps, and scrolls past a max height, so a long JSON value stays
            readable without pushing the rest of the drawer out of reach. */}
        <span className={styles.drawerValue}>
          {prettyJson(String(row.value ?? "")) ?? String(row.value ?? "")}
        </span>
      </DetailRow>
      <DetailRow label="Rule">
        <span className={styles.drawerRule}>
          <RuleCell
            rawId={String(row.ruleId ?? "")}
            reference={ruleReference}
          />
        </span>
      </DetailRow>
      {variationText && (
        <DetailRow label="Variation">
          <span className={styles.drawerMono}>{variationText}</span>
        </DetailRow>
      )}
      <DetailRow label="Source">
        <span className={styles.drawerMono}>{String(row.source ?? "")}</span>
      </DetailRow>
      {rowString(row, "environment") && (
        <DetailRow label="Environment">
          <span className={styles.drawerMono}>
            {rowString(row, "environment")}
          </span>
        </DetailRow>
      )}

      <DetailSectionLabel variant="heading" spaced>
        User Attributes
      </DetailSectionLabel>
      {groups ? (
        <>
          {/* "Used in targeting" claims only that a current rule looks at the
              attribute — not that it decided this row, which would need the
              row's history evaluated against config it predates. */}
          <div
            className={clsx(
              styles.drawerSubheading,
              styles.drawerSubheadingFirst,
            )}
          >
            Used in Targeting
          </div>
          {groups.targeted.map(attributeRow)}
          {groups.absent.map((key) => (
            <DetailRow key={key} label={key}>
              <span className={styles.drawerAbsent}>not sent</span>
            </DetailRow>
          ))}
          {/* Expanded by default and collapsible, count in the label; "Used in
              targeting" above is never collapsed. Never subdivided:
              the keys are customer-defined, and any taxonomy invented here
              would be wrong for most orgs. */}
          {groups.other.length > 0 && (
            <>
              <button
                type="button"
                className={clsx(
                  styles.drawerSubheading,
                  styles.drawerSubheadingSpaced,
                  styles.drawerSubheadingToggle,
                )}
                aria-expanded={otherOpen}
                onClick={() => setOtherOpen((open) => !open)}
              >
                {`Also Reported (${groups.other.length})`}
                <PiCaretRight
                  size={10}
                  aria-hidden
                  className={clsx(
                    styles.drawerToggleCaret,
                    otherOpen && styles.drawerToggleCaretOpen,
                  )}
                />
              </button>
              {otherOpen && groups.other.map(attributeRow)}
            </>
          )}
        </>
      ) : attributes ? (
        attributes.map(attributeRow)
      ) : (
        <DetailEmpty>
          This SDK isn&apos;t reporting user attributes. Evaluations still
          record who was served, but not what was known about them at the time.{" "}
          <DocLink docSection="targeting">About attributes</DocLink>
        </DetailEmpty>
      )}

      {/* The action sits on the section it acts on: "Copy" needs no noun, the
          label already names what is copied. Baseline-aligned so the label
          keeps its own spacing to the block. */}
      <Flex align="baseline" justify="between" className={styles.rawHeader}>
        <DetailSectionLabel variant="heading">JSON</DetailSectionLabel>
        <Button
          variant="ghost"
          size="sm"
          icon={copied ? <PiCheck aria-hidden /> : <PiCopy aria-hidden />}
          iconPosition="left"
          onClick={onCopy}
        >
          {copied ? "Copied!" : "Copy"}
        </Button>
      </Flex>
      <pre className={styles.drawerRaw}>{rowJson(row)}</pre>
    </>
  );
}

export default function FeatureDiagnostics({
  feature,
  results,
  setResults,
  revisionList,
  revisions,
  experiments,
}: {
  feature: FeatureInterface;
  results: Array<
    FeatureEvalDiagnosticsQueryResponseRows[number] & { id: string }
  > | null;
  setResults: (
    results: Array<
      FeatureEvalDiagnosticsQueryResponseRows[number] & { id: string }
    > | null,
  ) => void;
  /** Complete published history — which markers to draw. */
  revisionList?: MinimalFeatureRevisionInterface[];
  /** The five most recent, with rules — what a marker can say. */
  revisions?: FeatureRevisionInterface[];
  /** Already loaded by the page; names experiment-ref rules in the breakdown. */
  experiments?: ExperimentInterfaceStringDates[];
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorSql, setErrorSql] = useState<string | null>(null);

  const router = useRouter();
  // Same param as FeatureUsageGraph's dummy path — one switch turns the whole
  // feature page into something demoable without a warehouse behind it.
  const useDummyData = router.query["dummy"] === "true";

  // No provider needed here: FeatureUsageProvider already wraps the whole
  // feature page, and this tab renders inside it.
  const {
    showFeatureUsage,
    lookback,
    setLookback,
    mutateFeatureUsage,
    featureUsage,
    featureUsageSummary,
    featureUsageRows,
    featureUsageRowsMeta,
    usageUpdatedAt,
    scenarioMarkers,
    setUsageEnvironments,
    setUsageRowFilters,
  } = useFeatureUsage();

  const orgEnvironments = useEnvironments();

  /**
   * Environments relevant to THIS flag, as a union of two sets:
   *
   *  - enabled on the flag — it can receive evaluations, so a zero is worth
   *    reporting;
   *  - producing evaluations in the window — even when disabled.
   *
   * The first half keeps `dev` / `testing` out of a flag that was never turned
   * on there: they can never have evaluations, and listing them makes the
   * "none in this window" marker meaningless by attaching it to rows that could
   * never say anything else.
   *
   * The second half is the point of using a union rather than either alone. An
   * environment the flag is disabled in, still receiving evaluations, is an SDK
   * evaluating where it should not — the anomaly this picker most needs to
   * surface, and the one an enabled-only list would hide.
   */
  const evaluationsByEnvironment = useMemo(() => {
    const counts = new Map<string, number>();
    (featureUsageRows?.environment ?? []).forEach((row) => {
      counts.set(row.group, (counts.get(row.group) ?? 0) + row.evaluations);
    });
    return counts;
  }, [featureUsageRows]);

  // Environments ever listed stay listed. The counts come from the usage
  // rows, which are scoped by this very chip: without this, deselecting a
  // disabled environment that still receives traffic would drop it from the
  // list, with no way to select it again.
  const listedEnvironmentIds = useRef<Set<string>>(new Set());
  const environmentOptions: EnvironmentOption[] = useMemo(() => {
    const options = orgEnvironments
      .map((env) => ({
        id: env.id,
        enabled: !!feature.environmentSettings?.[env.id]?.enabled,
        evaluations: evaluationsByEnvironment.get(env.id) ?? 0,
      }))
      .filter(
        (env) =>
          env.enabled ||
          env.evaluations > 0 ||
          listedEnvironmentIds.current.has(env.id),
      );
    options.forEach((env) => listedEnvironmentIds.current.add(env.id));
    return options;
  }, [orgEnvironments, feature.environmentSettings, evaluationsByEnvironment]);

  /**
   * Defaults to everything relevant, and can never be emptied — the chip's
   * Apply refuses an empty selection, so this always names at least one.
   */
  const [selectedEnvironments, setSelectedEnvironments] = useState<string[]>(
    [],
  );
  const scopeInitialised = useRef(false);
  useEffect(() => {
    // Seeded once the options are known, then left alone so a later window
    // change cannot silently widen a scope the user narrowed.
    if (scopeInitialised.current || !environmentOptions.length) return;
    scopeInitialised.current = true;
    setSelectedEnvironments(environmentOptions.map((e) => e.id));
  }, [environmentOptions]);

  /**
   * The chip narrows when it excludes something it offers. Selecting every
   * option is the unscoped view — the endpoint's own default — so it sends
   * nothing, stays shared with the rest of the page, and keeps polling.
   */
  const environmentsNarrowed =
    selectedEnvironments.length > 0 &&
    environmentOptions.some((env) => !selectedEnvironments.includes(env.id));

  // The chip drives the chart and the breakdown panel through the provider's
  // usage request. Cleared on leaving the tab, so no other surface inherits a
  // scope it has no control for.
  useEffect(() => {
    setUsageEnvironments(environmentsNarrowed ? selectedEnvironments : null);
  }, [environmentsNarrowed, selectedEnvironments, setUsageEnvironments]);
  useEffect(() => () => setUsageEnvironments(null), [setUsageEnvironments]);

  // Committed filters. Staged editing lives inside the control bar's popover;
  // this is only what the surface is actually filtered by.
  const [panelFilters, setPanelFilters] = useState<RowFilter[]>([]);

  /**
   * Add Filter, applied: the committed filters in the server's shape. They
   * drive the chart and breakdown panel (through the provider's usage
   * request) and the stream (through its query) from this one value, set on
   * Apply — so one Apply is one refetch, and nothing refetches per keystroke.
   */
  const usageRowFilters = useMemo(
    () => toUsageRowFilters(panelFilters),
    [panelFilters],
  );
  useEffect(() => {
    setUsageRowFilters(usageRowFilters.length ? usageRowFilters : null);
  }, [usageRowFilters, setUsageRowFilters]);
  useEffect(() => () => setUsageRowFilters(null), [setUsageRowFilters]);

  /**
   * The grouping lives here, not in the chart card: a selection names the
   * dimension it was made in, so the two have to be cleared together.
   */
  const [groupBy, setGroupBy] = useState<FeatureUsageDimension>("value");

  /**
   * The bar selection. STREAM-SCOPED ONLY — it narrows the evaluation stream
   * and nothing else.
   *
   *   stream = time frame ∧ environment ∧ page filters ∧ bar selection
   *
   * Deliberately NOT fed back into the chart's own data. Collapsing the chart
   * to the selected bucket would destroy the context that made the bar worth
   * clicking — you would be left looking at the thing you selected with nothing
   * to compare it against.
   *
   * One selection at a time. Clicking another bar replaces it; this is a
   * selection, not a filter list, and the page-level filters above are where
   * accumulating constraints belong.
   *
   * Wired to the stream query: a selection re-runs it with a range and, when
   * the grouping's column exists in this data source's rows, a filter. See
   * `streamNarrowing` below for which parts of a selection are applied.
   *
   * Still not built: disclosing the row cap against the bucket total ("100 of
   * 412"). That needs a second aggregate per click, and on the generic path
   * its own COUNT(*) — a cost decision rather than an oversight.
   */
  const [selection, setSelection] = useState<{
    /** Bucket bounds, ms. */
    start: number;
    end: number;
    /** Absent for a column-background click: the whole bucket, any group. */
    groupField?: FeatureUsageDimension;
    groupValue?: string;
  } | null>(null);

  /**
   * Chart click -> selection. Toggles: clicking the same bar again clears it,
   * which is one of the four ways out (the others are the chip's ✕, Esc, and
   * any page-level change).
   *
   * The bucket's end comes from the shared width table rather than from the
   * gap to the next bar — the last bucket has no next bar, and a selection on
   * it would otherwise have no end.
   */
  const bucketMs = FEATURE_USAGE_BUCKET_SECONDS[lookback] * 1000;
  /**
   * The breakdown panel's selection: one series across the whole window, by
   * its key in the current grouping, with the label its chip shows. Mutually
   * exclusive with the bar selection — each clears the other — because the
   * chart can only dim against one of them. A new row replaces it.
   */
  const [seriesSelection, setSeriesSelection] = useState<{
    key: string;
    label: string;
  } | null>(null);
  const handleSeriesSelect = useCallback(
    (picked: { key: string; label: string } | null) => {
      setSelection(null);
      setSeriesSelection(picked);
    },
    [],
  );

  const handleChartSelect = useCallback(
    (picked: { x: number; group?: string }) => {
      setSeriesSelection(null);
      setSelection((current) => {
        const same =
          current &&
          current.start === picked.x &&
          current.groupValue === picked.group;
        if (same) return null;
        return {
          start: picked.x,
          end: picked.x + bucketMs,
          groupField: picked.group === undefined ? undefined : groupBy,
          groupValue: picked.group,
        };
      });
    },
    [bucketMs, groupBy],
  );

  /**
   * Cleared by every page-level change, because each one invalidates it in its
   * own way: a new time frame or environment means the bucket may not exist,
   * a filter change means the stream underneath it is a different population,
   * and a group-by switch strands the group constraint in a dimension that is
   * no longer shown — `source = experiment` means nothing once you are looking
   * at Value, and there is no honest re-mapping.
   *
   * Keyed on the values rather than wired into each setter so a future control
   * cannot forget to call it.
   */
  useEffect(() => {
    setSelection(null);
    setSeriesSelection(null);
  }, [lookback, selectedEnvironments, panelFilters, groupBy]);

  // Esc, while a selection is live.
  useEffect(() => {
    if (!selection && seriesSelection === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSelection(null);
      setSeriesSelection(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, seriesSelection]);

  const experimentsMap = useMemo(
    () => new Map((experiments ?? []).map((e) => [e.id, e])),
    [experiments],
  );
  const environmentIds = useMemo(
    () => environmentOptions.map((e) => e.id),
    [environmentOptions],
  );

  // When the data on screen was fetched. SWR exposes no such timestamp, and a
  // null here is what the "Never run" stamp reads.
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  /**
   * The tab's freshness stamp covers both of its queries — the chart's usage
   * request and the table's — so it reports whichever landed last. Feeding it
   * only the table's query was the bug: the chart renders from SWR without ever
   * touching it, so the header claimed nothing had loaded while the chart was
   * showing a total.
   */
  const headerUpdatedAt = useMemo(() => {
    const stamps = [updatedAt, usageUpdatedAt].filter(
      (d): d is Date => d !== null,
    );
    if (!stamps.length) return null;
    return new Date(Math.max(...stamps.map((d) => d.getTime())));
  }, [updatedAt, usageUpdatedAt]);

  const { datasources, getDatasourceById } = useDefinitions();
  const settings = useOrgSettings();
  const { apiCall } = useAuth();

  const validDatasources = useMemo(() => {
    return datasources.filter((d) => {
      if (!isProjectListValidForProject(d.projects, feature.project))
        return false;
      return true;
    });
  }, [datasources, feature.project]);

  const form = useForm({
    defaultValues: {
      ...getDatasourceInitialFormValue(
        validDatasources,
        settings,
        feature.project,
      ),
    },
  });

  const datasourceId = form.watch("datasourceId");
  const datasource = datasourceId ? getDatasourceById(datasourceId) : null;

  const awaitingProvisioning = datasource
    ? isManagedWarehouseUnavailable(datasource)
    : false;

  // Managed warehouse natively supports diagnostics via its feature_usage table.
  // Event forwarder and regular datasources need a configured feature usage query.
  const datasourceHasFeatureUsageQuery =
    datasource &&
    !awaitingProvisioning &&
    (datasource.type === "growthbook_clickhouse" ||
      !!getActiveFeatureUsageQuery(datasource.settings?.queries?.featureUsage));

  // Synthesized per feature and time window rather than pushed through
  // setResults: writing to the page's state during render would be a side
  // effect, and the real query path should keep sole ownership of that state.
  // The environments are the ones the flag is enabled in — stable, and not
  // derived from the chip they are filtered by.
  const dummyEnvironmentIds = useMemo(
    () =>
      orgEnvironments
        .filter((env) => feature.environmentSettings?.[env.id]?.enabled)
        .map((env) => env.id),
    [orgEnvironments, feature.environmentSettings],
  );
  const dummyResults = useMemo(
    () =>
      useDummyData
        ? getDummyDiagnosticsRows(feature, dummyEnvironmentIds, lookback)
        : null,
    [useDummyData, feature, dummyEnvironmentIds, lookback],
  );
  // Everything downstream reads this, so the table, search, sort and pagination
  // are the same code in both modes.
  const displayResults = useDummyData ? dummyResults : results;

  /**
   * Which of the four fields this data source's stream rows actually carry.
   *
   * Derived from the rows, not assumed: a generic data source wraps a query
   * the customer wrote, which only has to emit `timestamp` and `feature_key`.
   * A field is filterable only if its column came back, so the page never
   * offers a filter that would make the query fail.
   *
   * Remembered from the last run that returned rows, because a filtered run
   * that matches nothing returns no keys — and the column did not stop
   * existing. Before any run, the managed warehouse's columns are known from
   * its fixed query (ClickHouse#getFeatureEvalDiagnosticsQuery); a generic
   * source's are not, so nothing on it is filterable until it has run once.
   */
  const [streamColumns, setStreamColumns] = useState<string[] | null>(null);
  useEffect(() => {
    setStreamColumns(null);
  }, [datasourceId]);
  useEffect(() => {
    if (displayResults?.length)
      setStreamColumns(Object.keys(displayResults[0]));
  }, [displayResults]);
  const knownStreamColumns =
    streamColumns ??
    (datasource?.type === "growthbook_clickhouse"
      ? MANAGED_STREAM_COLUMNS
      : null);

  const filterColumnFor = useCallback(
    (dimension: FeatureUsageDimension) => {
      if (!knownStreamColumns) return null;
      // Case-insensitive: some warehouses return identifiers upper-cased, and
      // the unquoted canonical name folds to match them in the query.
      const present = new Set(knownStreamColumns.map((c) => c.toLowerCase()));
      return (
        STREAM_FILTER_COLUMNS[dimension].find((c) =>
          present.has(c.toLowerCase()),
        ) ?? null
      );
    },
    [knownStreamColumns],
  );

  /**
   * A selection only narrows within the filter. A breakdown row a filter on
   * the grouped column excludes is not offered, so the panel never offers a
   * path to rows the filter has ruled out.
   */
  const isOutsideFilter = useCallback(
    (key: string) =>
      usageRowFilters.some(
        (f) => f.column === groupBy && !matchesUsageRowFilter(key, f),
      ),
    [usageRowFilters, groupBy],
  );

  /** Why the current grouping cannot filter the stream, or null if it can. */
  const seriesFilterUnavailable = !knownStreamColumns
    ? "Run the query once to filter the stream by this"
    : filterColumnFor(groupBy)
      ? null
      : `This data source has no ${STREAM_FILTER_COLUMNS[groupBy][0]} column to filter the stream by`;

  /**
   * The selection as applied. A bar's group only applies when its column
   * exists and it names one group — "(other)" is several, so it cannot. When
   * it does not apply, the bar selects its whole column instead: the chart
   * lights the column, the chip names only the bucket, and the query narrows
   * only by time. Nothing claims a filter that is not in the query.
   */
  const appliedSelection = useMemo(() => {
    if (!selection) return null;
    const groupApplies =
      selection.groupField !== undefined &&
      selection.groupValue !== undefined &&
      selection.groupValue !== "(other)" &&
      !!filterColumnFor(selection.groupField);
    return groupApplies
      ? selection
      : { start: selection.start, end: selection.end };
  }, [selection, filterColumnFor]);

  const streamNarrowing = useMemo(() => {
    if (appliedSelection) {
      const column =
        appliedSelection.groupField !== undefined
          ? filterColumnFor(appliedSelection.groupField)
          : null;
      return {
        range: { start: appliedSelection.start, end: appliedSelection.end },
        ...(column && appliedSelection.groupValue !== undefined
          ? { filter: { column, value: appliedSelection.groupValue } }
          : {}),
      };
    }
    if (seriesSelection) {
      const column = filterColumnFor(groupBy);
      if (column) {
        return { filter: { column, value: seriesSelection.key } };
      }
    }
    return null;
  }, [appliedSelection, seriesSelection, groupBy, filterColumnFor]);

  /**
   * What the chart needs to dim against: the x it was clicked at, and the
   * group if a segment rather than the column background.
   */
  const chartSelection = appliedSelection
    ? { x: appliedSelection.start, group: appliedSelection.groupValue }
    : null;

  /**
   * Dummy mode has no query to run, so the synthetic rows are narrowed here.
   * Only for the demo data: real rows are always narrowed by the query, since
   * filtering the loaded rows would miss everything older than them.
   */
  /**
   * The chip's scope for the stream query — the same environments the chart
   * and panel use, so the page never shows two scopes at once. Only sent when
   * the stream's rows carry an environment column; a generic query without
   * one is left unscoped rather than made to fail.
   */
  /**
   * Add Filter for the stream, in the spelling its rows use: a generic data
   * source's query may name the rule and variation columns rule_id /
   * variation_id. A filter whose column the rows do not carry at all cannot
   * apply to the stream; that is said in words rather than discovered as a
   * failed query. Before the columns are known, filters go as named.
   */
  const { streamRowFilters, streamFilterProblem } = useMemo(() => {
    const present = knownStreamColumns
      ? new Set(knownStreamColumns.map((c) => c.toLowerCase()))
      : null;
    const aliases: Record<string, "rule_id" | "variation_id"> = {
      ruleId: "rule_id",
      variationId: "variation_id",
    };
    let problem: string | null = null;
    const mapped = usageRowFilters.map((f) => {
      if (!present || present.has(f.column.toLowerCase())) return f;
      const alias = aliases[f.column];
      if (alias && present.has(alias)) return { ...f, columnAlias: alias };
      problem = `This data source's evaluation rows have no ${streamColumnLabel(
        f.column,
      )} column, so the ${streamColumnLabel(f.column)} filter can't apply to the stream.`;
      return f;
    });
    return {
      streamRowFilters: mapped.length ? mapped : null,
      streamFilterProblem: problem as string | null,
    };
  }, [usageRowFilters, knownStreamColumns]);

  const streamEnvironments =
    environmentsNarrowed && filterColumnFor("environment")
      ? selectedEnvironments
      : null;

  const streamRows = useMemo(() => {
    if (
      !useDummyData ||
      !displayResults ||
      (!streamNarrowing && !streamEnvironments)
    ) {
      return displayResults;
    }
    const { filter, range } = (streamNarrowing ?? {}) as {
      filter?: { column: string; value: string };
      range?: { start: number; end: number };
    };
    return displayResults.filter((row) => {
      if (
        streamEnvironments &&
        !streamEnvironments.includes(String(row.environment))
      ) {
        return false;
      }
      if (
        filter &&
        String(row[filter.column as keyof typeof row]) !== filter.value
      ) {
        return false;
      }
      if (range) {
        const t = getValidDate(row.timestamp).getTime();
        if (t < range.start || t >= range.end) return false;
      }
      return true;
    });
  }, [useDummyData, displayResults, streamNarrowing, streamEnvironments]);

  /**
   * The managed warehouse's projection is fixed, so its columns are a fixed
   * set in a fixed order. Environment is always on — the environment scope does
   * not reach the query, so rows from every environment arrive and the values
   * genuinely differ. Dummy rows mirror the managed shape.
   *
   * User ID and Variation each show only if some fetched row carries one. Read
   * from the whole result set, never the visible page, so they hold still
   * while paging and change only when the query re-runs.
   *
   * A generic data source wraps a query the customer wrote, where only
   * timestamp and feature_key are guaranteed, so its columns are still read
   * from the first row, exactly as before.
   */
  const managedStream =
    useDummyData || datasource?.type === "growthbook_clickhouse";

  const columns = useMemo(() => {
    if (displayResults === null || displayResults.length === 0) return [];
    const hasValues = (key: string) =>
      displayResults.some((row) => (row[key] ?? "") !== "");
    if (managedStream) {
      // Identity first (with Timestamp, what you scan to find a row), then
      // the explanation chain, then Variation as its finest step. Environment
      // qualifies all of it rather than being a step in it, so it goes last.
      return [
        ...(hasValues("unit_id") ? ["unit_id"] : []),
        ...MANAGED_STREAM_TABLE_COLUMNS,
        ...(hasValues("variationId") ? ["variationId"] : []),
        "environment",
      ];
    }
    const keysSet = new Set<string>();
    // Only iterate over the first row since all rows have the same structure
    Object.keys(displayResults[0]).forEach((key) => {
      if (key !== "id" && key !== "timestamp" && key !== "feature_key") {
        keysSet.add(key);
      }
    });

    // Arrival order from the query is whatever the SELECT happened to list, so
    // it is sorted into the deliberate order above. Unlisted keys sort to the
    // end (index -1 -> length) and hold their arrival order between themselves,
    // since sort is stable.
    const rank = (key: string) => {
      const i = COLUMN_ORDER.indexOf(key);
      return i === -1 ? COLUMN_ORDER.length : i;
    };
    return Array.from(keysSet).sort((a, b) => rank(a) - rank(b));
  }, [displayResults, managedStream]);

  /**
   * Timestamp format and width, decided once from the whole fetched result set
   * like the column gates above, so it never truncates and holds still while
   * paging. See planStreamTimestamps.
   */
  const timestampPlan = useMemo(
    () => planStreamTimestamps(displayResults ?? []),
    [displayResults],
  );

  /**
   * The Rule cell's reference: the breakdown panel's own resolver, so a rule
   * has one name and one colour across the card. Stem-matched inside it.
   */
  const resolveRuleCell = useMemo(
    () => buildRuleCellResolver(feature.rules ?? [], experimentsMap),
    [feature.rules, experimentsMap],
  );

  // "(0) Control" from the flag's current config; the bare index when the
  // config has no name for it.
  const variationLabel = useMemo(
    () => buildVariationLabeler(feature.rules ?? [], experimentsMap),
    [feature.rules, experimentsMap],
  );

  const evalItems = useAddComputedFields(
    streamRows ?? [],
    (row) => {
      const timestampDate = getValidDate(row.timestamp);
      // Compute display values for all columns
      const displayValues: Record<string, string> = {};
      columns.forEach((key) => {
        displayValues[key] =
          managedStream && key === "variationId"
            ? variationLabel(
                String(row.ruleId ?? ""),
                String(row.variationId ?? ""),
              )
            : formatDisplayValue(row[key]);
      });

      return {
        timestamp: timestampPlan.format(row.timestamp, timestampDate),
        timestampSort: timestampDate.getTime(),
        ...displayValues,
      } as {
        timestamp: string;
        timestampSort: number;
      } & Record<string, string | number>;
    },
    [streamRows, columns, managedStream, timestampPlan, variationLabel],
  );

  // Values come from what is actually loaded, so the builder offers real
  // options rather than free text. Deliberately excludes userId (the search box
  // covers it) and timestamp (the time frame does).
  const columnSource = useMemo(() => {
    // No "environment": the scope chip in the control bar owns it. Two paths to
    // the same setting would need syncing and would drift — and the chip is the
    // better of the two, since it always has a value and lists environments the
    // flag is configured for.
    //
    // Same order and names as the group-by control (Value, Rule, Source),
    // read top to bottom where that reads left to right, so one field is
    // called one thing in both places. Variation has no group-by counterpart
    // and follows, named as its stream column is.
    const filterable = [
      { value: "value", label: GROUP_BY_LABELS.value },
      { value: "ruleId", label: GROUP_BY_LABELS.ruleId },
      { value: "source", label: GROUP_BY_LABELS.source },
      { value: "variationId", label: streamColumnLabel("variationId") },
    ];
    return {
      columns: filterable,
      savedFilters: [],
      getColumnInfo: (column: string | undefined) => ({
        datatype: "string" as const,
        topValues: column
          ? [
              ...new Set(
                (displayResults ?? [])
                  .map((r) => r[column])
                  .filter(
                    (v): v is string => typeof v === "string" && v !== "",
                  ),
              ),
            ].sort()
          : [],
      }),
    };
  }, [displayResults]);

  // No `pageSize`: the hook's own pagination is a bare Pagination with a fixed
  // page size and no rows-per-page control. Paginating here instead — over the
  // rows it has already filtered and sorted — is what lets this share the Event
  // Logs footer, which is the same slice against host-owned state.
  /**
   * Managed path only: each column sized to the widest value it holds across
   * the full fetched set (never below its header), within its bounds. From `evalItems` — the display strings, before search and
   * paging — so widths hold still while paging and searching.
   */
  const columnWidths = useMemo(
    () =>
      managedStream
        ? planStreamColumnWidths(
            ["timestamp", ...columns],
            evalItems as Record<string, unknown>[],
            (key) =>
              key === "timestamp" ? "Timestamp" : managedStreamColumnLabel(key),
            (key, row) =>
              key === "ruleId"
                ? ruleCellText(
                    resolveRuleCell(String(row[key] ?? "")),
                    row[key],
                  )
                : String(row[key] ?? ""),
          )
        : null,
    [managedStream, columns, evalItems, resolveRuleCell],
  );

  /**
   * Floor for the table, in the cells' `ch`: every sized column plus its
   * padding. Full width above that; the trailing column takes the rest.
   */
  const tableWidthStyle = useMemo(() => {
    if (!columnWidths) return undefined;
    const widths = Object.values(columnWidths);
    const totalCh = widths.reduce((sum, n) => sum + n, 0);
    const extraPx = Object.keys(columnWidths).reduce(
      (sum, key) => sum + (STREAM_COLUMN_EXTRA_PX[key] ?? 0),
      0,
    );
    return {
      // The trailing column is unsized but still carries its padding, the
      // caret's 28px on the right.
      "--stream-table-min-width": `calc(${totalCh}ch + ${widths.length} * 2 * var(--space-3) + ${extraPx}px + var(--space-3) + 28px)`,
    } as CSSProperties;
  }, [columnWidths]);

  const {
    items,
    SortableTableColumnHeader,
    searchInputProps,
    setSearchValue,
    isFiltered,
  } = useSearch({
    items: evalItems,
    defaultSortField: "timestampSort",
    defaultSortDir: -1,
    localStorageKey: "feature-diagnostics-v2",
    searchFields: ["timestamp", ...columns],
  });

  /**
   * Whether the header bar is currently pinned, which is what decides if it
   * carries the shadow for itself and the tabs above it.
   *
   * Kept in a callback ref rather than a useRef so the observer attaches when
   * the element appears — this component returns an empty state before the bar
   * exists, and a ref read once on mount would be null forever in that case.
   */
  const [stickySentinel, setStickySentinel] = useState<HTMLDivElement | null>(
    null,
  );
  const [headerStuck, setHeaderStuck] = useState(false);
  useEffect(() => {
    if (!stickySentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setHeaderStuck(!entry.isIntersecting),
      {
        root: null,
        rootMargin: `-${STICKY_HEADER_TOP_PX}px 0px 0px 0px`,
        threshold: 0,
      },
    );
    observer.observe(stickySentinel);
    return () => observer.disconnect();
  }, [stickySentinel]);

  const [page, setPage] = useState(1);

  /**
   * The row whose drawer is open, by its id in the current result set. That id
   * is positional and means nothing across runs, so the selection is cleared
   * whenever the fetched set or its narrowing changes — never carried over.
   */
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  // Carets by row id, so focus returns to the one that opened the drawer.
  const caretRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => {
    setOpenRowId(null);
  }, [displayResults, streamNarrowing]);
  // The raw row as fetched — not the table's display strings — so the drawer
  // shows real values and Raw is the actual JSON.
  const openRow = useMemo(
    () =>
      openRowId === null
        ? null
        : ((displayResults ?? []).find((r) => r.id === openRowId) ?? null),
    [openRowId, displayResults],
  );
  const closeDrawer = useCallback(() => {
    const id = openRowId;
    setOpenRowId(null);
    if (id) caretRefs.current[id]?.focus();
  }, [openRowId]);
  const { performCopy, copySuccess } = useCopyToClipboard({ timeout: 1500 });
  const [rowsPerPage, setRowsPerPage] = useState(STREAM_DEFAULT_ROWS_PER_PAGE);

  // Clamped rather than reset: a search that shrinks the result set below the
  // current page lands the reader on the last page instead of stranding them on
  // an empty one. The page count floors at 1 so an empty result is still page 1
  // of 1 rather than page 1 of 0.
  const pageCount = Math.max(1, Math.ceil(items.length / rowsPerPage));
  const currentPage = Math.min(page, pageCount);
  const visibleItems = items.slice(
    (currentPage - 1) * rowsPerPage,
    currentPage * rowsPerPage,
  );

  /**
   * An empty chart alone cannot tell these apart, which is the whole reason the
   * stat row exists. The discriminator is deliberately not "is the result
   * empty": "your flag is broken" and "your filter is too narrow" look
   * identical on the plot and need opposite responses from the reader.
   */
  const windowTotal = featureUsage?.total ?? 0;
  const lifetimeTotal = featureUsageSummary?.lifetimeTotal ?? 0;
  // What actually narrows the data. Add Filter does not reach any query yet,
  // so it is not counted.
  const filtersActive =
    environmentsNarrowed || usageRowFilters.length > 0 || isFiltered;

  /**
   * A search narrows only the loaded rows, so its count is of matches among
   * them.
   */
  const streamSummary = (() => {
    // Not a claim to make while the rows are still arriving.
    if (items.length === 0) return loading ? "" : "No evaluations match";
    const first = (currentPage - 1) * rowsPerPage + 1;
    const last = Math.min(currentPage * rowsPerPage, items.length);
    const range = `${first.toLocaleString()}–${last.toLocaleString()}`;
    const of = items.length.toLocaleString();
    return isFiltered ? `${range} of ${of} matches` : `${range} of ${of}`;
  })();
  // Both have to have landed before any of this is meaningful — judging off a
  // half-loaded pair would flash "stopped" on every page load.
  const usageLoaded = !!featureUsage && !!featureUsageSummary;

  /**
   * Past this, silence is a finding. Below it, silence is just a window
   * narrower than the gap between evaluations — on the shortest preset (15
   * minutes) a flag evaluating a few times an hour is legitimately quiet, and
   * calling that "stopped" asserts a conclusion the data does not support.
   */
  const STOPPED_GAP_MS = 24 * 60 * 60 * 1000;
  const lastEvaluatedMs = featureUsageSummary?.lastEvaluated
    ? new Date(featureUsageSummary.lastEvaluated).getTime()
    : null;
  const evaluationGapMs =
    lastEvaluatedMs === null ? null : Date.now() - lastEvaluatedMs;

  const diagnosticsState:
    | "loading"
    | "ok"
    | "never"
    | "stopped"
    | "quiet"
    | "filtered" = !usageLoaded
    ? "loading"
    : lifetimeTotal === 0
      ? "never"
      : windowTotal > 0
        ? "ok"
        : filtersActive
          ? "filtered"
          : evaluationGapMs !== null && evaluationGapMs > STOPPED_GAP_MS
            ? "stopped"
            : "quiet";

  /**
   * The two halves of the merged card, and what each one actually depends on.
   *
   * They are not the same condition: the chart needs usage data to exist at
   * all, while the table needs a datasource wired up. Keeping them separate is
   * why the card can render with only one half present.
   */
  const showChartHalf = showFeatureUsage && diagnosticsState !== "never";
  const showStreamHalf = !!(
    useDummyData ||
    (datasource && datasourceHasFeatureUsageQuery)
  );

  // Names the window the person actually chose, rather than a fixed string that
  // would be wrong on three of the four presets.
  const windowLabel =
    LOOKBACK_PRESETS.find((p) => p.id === lookback)?.label.toLowerCase() ??
    "the selected window";

  /**
   * Latest-wins guard. A time-frame change re-runs the query while an earlier
   * run may still be in flight; only the newest response is allowed to land,
   * or a slow 7-day response could overwrite a fast 15-minute one under a
   * control that says "Last 15 minutes".
   */
  const queryRunRef = useRef(0);

  const onRunFeatureUsageQuery = async () => {
    const run = ++queryRunRef.current;
    setError(null);
    setErrorSql(null);
    if (streamFilterProblem) {
      setError(streamFilterProblem);
      return;
    }
    setLoading(true);
    try {
      const results = await apiCall<FeatureEvaluationDiagnosticsQueryResults>(
        "/query/feature-eval-diagnostic",
        {
          method: "POST",
          body: JSON.stringify({
            feature: feature.id,
            datasourceId: form.watch("datasourceId"),
            // The window the control bar shows. Without it the endpoint falls
            // back to its historical 7 days, so the stream described a
            // different period from the one on screen.
            lookback,
            // A selection's range (ms) and filter. The server validates both;
            // the column is looked up from a fixed set, never interpolated.
            ...(streamNarrowing ?? {}),
            ...(streamEnvironments ? { environments: streamEnvironments } : {}),
            ...(streamRowFilters ? { rowFilters: streamRowFilters } : {}),
          }),
        },
        (responseData) => {
          if (typeof responseData?.sql === "string") {
            setErrorSql(responseData.sql);
          }
        },
      );
      if (run !== queryRunRef.current) return;
      setUpdatedAt(new Date());
      if (results.rows) {
        const rowsWithId = results.rows.map((row, index) => ({
          ...row,
          id: index.toString(),
        }));
        setResults(rowsWithId);
      } else {
        setResults([]);
      }
    } catch (e) {
      if (run !== queryRunRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (run === queryRunRef.current) setLoading(false);
    }
  };

  /**
   * Rows on screen always describe the window the control shows. Once a query
   * has run, a time-frame change re-runs it; before the first run there is
   * nothing on screen to contradict the control, so nothing is spent.
   */
  const runQueryRef = useRef(onRunFeatureUsageQuery);
  runQueryRef.current = onRunFeatureUsageQuery;
  // The window and the selection together: either changing re-runs the query.
  // A selection runs it even before a first manual run, since clicking one is
  // asking for the narrowed stream.
  const streamQueryKey = `${lookback}|${JSON.stringify(
    streamNarrowing,
  )}|${JSON.stringify(streamEnvironments)}|${JSON.stringify(streamRowFilters)}`;
  const lastStreamQueryKey = useRef(streamQueryKey);
  useEffect(() => {
    if (lastStreamQueryKey.current === streamQueryKey) return;
    lastStreamQueryKey.current = streamQueryKey;
    if (useDummyData) return;
    if (results === null && !streamNarrowing) return;
    runQueryRef.current();
  }, [streamQueryKey, results, useDummyData, streamNarrowing]);

  // Empty State: Prompt user to set up a data source to view diagnostics for this feature
  // Skipped under ?dummy=true, which is the case with no datasource at all.
  if (validDatasources.length === 0 && !useDummyData) {
    return (
      <Box className="contents container-fluid pagecontents">
        <EmptyState
          title="Feature Evaluation Diagnostics"
          description="Set up a data source to view diagnostics for this feature."
          leftButton={
            <LinkButton href="/datasources">Set up a Data Source</LinkButton>
          }
          rightButton={null}
        />
      </Box>
    );
  }

  return (
    <Box
      className="contents container-fluid pagecontents"
      // Overrides the 15px `.contents` gives every tab. Inline rather than a
      // class because `.contents` is a single class from global.scss and any
      // override of equal weight would win or lose on stylesheet order. Scoped
      // here so the other feature tabs keep their own spacing.
      //
      // Zero here because the 20px moved onto the sticky header below: padding
      // on this container scrolls away with the page, which let the title meet
      // the topbar once the header stuck.
      style={{ paddingTop: 0 }}
    >
      {/* Above the filter row, because Refresh re-runs the chart, the table
          and the filters — it cannot sit inside one of the things it
          refreshes. The stamp here is about the QUERY ("Refreshed"), which is
          a different fact from the data clock the stream half reports
          below ("last evaluated"); they were contradicting each other while
          they shared a word. */}
      {/* A zero-height marker at the bar's resting position. A sticky element
          cannot report its own state in CSS, so "is it pinned" is read as
          "has this scrolled past the point the bar stops at" — the same
          sentinel-and-observer pattern FeaturesHeader uses for the tabs, and
          offset by the same number the bar sticks at. */}
      <div
        ref={setStickySentinel}
        aria-hidden
        style={{ height: 1, width: "100%", pointerEvents: "none" }}
      />
      <Box
        className={clsx(styles.stickyHeader, {
          [styles.stickyHeaderStuck]: headerStuck,
        })}
      >
        <DataCardHeader
          title="Feature Evaluations"
          // No rule under this one: the filter row below has its own bottom
          // border, and two lines that close together read as an empty band.
          showDivider={false}
          updatedAt={headerUpdatedAt}
          error={error ? new Error(error) : null}
          refreshing={loading}
          // "Run Query", not "Refresh": this spends a query against the
          // customer's warehouse, and "Refresh" implies something cheap and
          // instant. Matches ImportExperimentList's Title Case.
          //
          // Deliberately NOT state-dependent. The neighbouring Run Analysis /
          // Run Query buttons flip to "Refresh Data" / "Get New Data" once
          // results exist; here the second run costs exactly what the first did,
          // so a label implying otherwise would be a cost lie — and it would be
          // the label showing almost all the time.
          refreshLabel="Run Query"
          // Single clockwise arrow, bold weight. Note it is deliberately NOT the
          // plural PiArrowsClockwiseBold that DataCardHeader defaults to for
          // "Refresh" — the label beside it carries the cost meaning, so the icon
          // does not have to.
          refreshIcon={<PiArrowClockwiseBold aria-hidden />}
          // "Last run", not "Updated": "Updated" is the past tense of the verb
          // this button no longer uses, and it is ambiguous between the two
          // clocks on this page. "Last run" can only mean the query.
          freshnessVerb="Last run"
          freshnessEmptyLabel="Not run yet"
          // One step below the text beside it: the icon is a marker for what the
          // stamp is, not part of the value being read.
          freshnessIcon={
            <PiClockBold
              size={13}
              aria-hidden
              style={{ color: "var(--color-text-low)" }}
            />
          }
          onRefresh={() => {
            mutateFeatureUsage();
            onRunFeatureUsageQuery();
          }}
        />
      </Box>

      <FeatureDiagnosticsControlBar
        lookback={lookback}
        onLookbackChange={setLookback}
        environmentOptions={environmentOptions}
        selectedEnvironments={selectedEnvironments}
        onSelectedEnvironmentsChange={setSelectedEnvironments}
        filters={panelFilters}
        onFiltersChange={setPanelFilters}
        columnSource={columnSource}
      />

      {/* Already true under ?dummy=true, so this renders off the same synthetic
          data the table below does. Its own lookback selector is hidden: the
          control bar above owns the time frame, and two of them on one screen
          would eventually disagree. */}
      {showFeatureUsage && diagnosticsState === "never" && (
        <Callout status="info" mb="4">
          <Text size="md" weight="semibold">
            {`No evaluations in the last ${
              featureUsageSummary?.lookbackDays ?? 90
            } days`}
          </Text>
          {/* Bounded scan, so this cannot say "never" — only that nothing
              arrived inside the window it actually looked at. */}
          <Box mt="2" mb="1">
            <Text size="sm" color="text-mid">
              The usual causes:
            </Text>
          </Box>
          <ul className="mb-0 pl-4">
            <li>
              <Text size="sm" color="text-mid">
                The SDK is not reporting feature usage
              </Text>
            </li>
            <li>
              <Text size="sm" color="text-mid">
                {`Nothing references the key "${feature.id}"`}
              </Text>
            </li>
            <li>
              <Text size="sm" color="text-mid">
                No feature usage query is configured on the data source
              </Text>
            </li>
          </ul>
        </Callout>
      )}

      {showFeatureUsage &&
        diagnosticsState === "stopped" &&
        featureUsageSummary?.lastEvaluated && (
          <Callout status="warning" mb="4">
            {/* Date interpolated from lastEvaluated rather than written in:
                a hardcoded date would be wrong the day after it shipped. */}
            {`Evaluating normally until ${date(
              featureUsageSummary.lastEvaluated,
            )}, then stopped. Nothing has arrived in the selected time frame.`}
          </Callout>
        )}

      {showFeatureUsage &&
        diagnosticsState === "quiet" &&
        featureUsageSummary?.lastEvaluated && (
          <Callout status="info" mb="4">
            {/* States the gap; does not interpret it. Everything here is a
                measurement — the reader draws the conclusion. */}
            {`No evaluations in ${windowLabel}. Most recent was ${ago(
              featureUsageSummary.lastEvaluated,
            )}. Try a longer time frame.`}
          </Callout>
        )}

      {showFeatureUsage && diagnosticsState === "filtered" && (
        <Callout status="info" mb="4">
          {/* Names only what actually narrows the results: the time range,
              and the environment chip and filters when they are applied. */}
          {`No evaluations match this time frame${
            environmentsNarrowed ? " in the selected environments" : ""
          }. Try a longer time frame${
            environmentsNarrowed ? ", more environments" : ""
          }${usageRowFilters.length ? ", or clear a filter" : ""}.`}
        </Callout>
      )}

      {!useDummyData && datasource && awaitingProvisioning && (
        <ManagedWarehouseNoEventsCallout />
      )}

      {!useDummyData &&
        datasource &&
        !awaitingProvisioning &&
        !datasourceHasFeatureUsageQuery && (
          <Callout status="info" mb="4">
            Feature Evaluation Diagnostics require setting up a feature usage
            query in your data source.
            <Link href={`/datasources/${datasource.id}`} ml="2">
              Setup a Feature Usage Query
            </Link>
          </Callout>
        )}

      {/* ONE card. The chart and the table are two views of a single query —
          summary on top, detail below — so the boundary between them was
          padding and a gap standing in for a distinction that does not exist.

          Both halves are still conditional, because they answer to different
          things: the chart needs usage data to exist, the table needs a
          datasource wired up. The card renders if either does. */}
      {(showChartHalf || showStreamHalf) && (
        <Frame mt="4">
          {showChartHalf && (
            <FeatureEvaluationsCard
              rowsByDimension={featureUsageRows}
              rowsMeta={featureUsageRowsMeta}
              total={featureUsage?.total ?? 0}
              revisions={revisionList}
              revisionLabel={buildRevisionLabel(revisions)}
              markerOverride={scenarioMarkers}
              groupBy={groupBy}
              setGroupBy={setGroupBy}
              selection={chartSelection}
              onSelect={handleChartSelect}
              rules={feature.rules ?? []}
              // Holdout occupies slot #1, as on the rule cards.
              ruleNumberOffset={feature.holdout?.id ? 2 : 1}
              experimentsMap={experimentsMap}
              scopeEnvironments={selectedEnvironments}
              environmentIds={environmentIds}
              valueType={feature.valueType}
              seriesSelection={seriesSelection?.key ?? null}
              onSeriesSelect={handleSeriesSelect}
              seriesFilterUnavailable={seriesFilterUnavailable}
              isOutsideFilter={isOutsideFilter}
            />
          )}

          {/* Back between the halves. The plot lost its bordered container a
              few rounds ago, so nothing was drawing the boundary any more and
              the search row read as a control on the chart. Inset to the
              card's content edges, not bled to its border. */}
          {showChartHalf && showStreamHalf && (
            <Box className={styles.cardDivider} />
          )}

          {showStreamHalf && (
            <>
              {/* The search and the selection chip share a row: both scope the
              table, and the chip has no header to live on now that the
              "Evaluation Stream" heading is gone. Keeping it below the divider
              is what still says it narrows the table and not the chart. */}
              {/* Names the lower half of the card, above everything that
                  belongs to it — the search, the table and its footer all
                  sit under this.

                  An h3, subordinate to the card's own "Feature Evaluations" h2:
                  the two halves are one section, and a peer-level heading would
                  read as a second section inside the card.

                  The gap to the chart is the divider's, above. */}
              {/* 12px to the search row. */}
              <Box mb="3">
                <Heading as="h3" size="sm" mb="0">
                  Evaluation Stream
                </Heading>
              </Box>

              {/* Search spans the table's width, 12px above it. A bar
                  selection's chip, when there is one, takes its own width at
                  the end of the row and the search yields to it. */}
              <Flex align="center" gap="2" mb="3" wrap="wrap">
                <Box style={{ flex: "1 1 auto", minWidth: 0 }}>
                  {/* Committed on blur or Enter rather than per keystroke, the same
                as the Event Logs stream. Here that is about the reader rather
                than about a request: filtering, re-sorting and re-paging on
                every character moves rows out from under the cursor while it
                is still being typed. */}
                  <StreamSearchField
                    value={searchInputProps.value}
                    onChange={(v) => {
                      setSearchValue(v);
                      // A new search is a new result set, so it starts at its own
                      // first page rather than wherever the last one had got to.
                      setPage(1);
                    }}
                    placeholder="Search evaluations..."
                  />
                </Box>

                {seriesSelection && streamNarrowing ? (
                  <Flex align="center" gap="2" className={styles.selectionChip}>
                    <PiChartBarBold size={12} aria-hidden />
                    <Text size="sm">
                      {/* "Showing:" marks a selection, which lives with the
                          stream it narrows; a filter reads "Value = false" in
                          the filter row. */}
                      {`Showing: ${seriesSelection.label}`}
                    </Text>
                    <button
                      type="button"
                      aria-label="Clear series selection"
                      className={styles.selectionChipClear}
                      onClick={() => setSeriesSelection(null)}
                    >
                      <PiXBold size={10} aria-hidden />
                    </button>
                  </Flex>
                ) : null}
                {appliedSelection ? (
                  <Flex align="center" gap="2" className={styles.selectionChip}>
                    <PiChartBarBold size={12} aria-hidden />
                    <Text size="sm">
                      {`Showing: ${describeSelection(appliedSelection, bucketMs)}`}
                    </Text>
                    <button
                      type="button"
                      aria-label="Clear bar selection"
                      className={styles.selectionChipClear}
                      onClick={() => setSelection(null)}
                    >
                      <PiXBold size={10} aria-hidden />
                    </button>
                  </Flex>
                ) : null}
              </Flex>
              {error && errorSql ? (
                <Box my="3">
                  <DisplayTestQueryResults
                    results={[]}
                    duration={0}
                    sql={errorSql}
                    error={error}
                    expandable={true}
                  />
                </Box>
              ) : error ? (
                <Callout status="error" my="3">
                  <strong>Error:</strong> {error}
                </Callout>
              ) : null}
              {/* Constant height across states, so committing a search that matches
              nothing does not collapse the card and pull the page up under the
              reader. Reserves a full page of rows: the 30px header plus 30px
              per row, from the current page size. */}
              <Box
                className={streamTableStyles.resultsArea}
                style={{ minHeight: 30 + rowsPerPage * 30, ...tableWidthStyle }}
              >
                {items.length === 0 && !error && loading && (
                  // Nothing loaded to hold the shape of, so placeholder rows
                  // at the table's 30px pitch, one page's worth.
                  <Box aria-hidden className={styles.emptyFrame}>
                    {Array.from({ length: rowsPerPage }, (_, i) => (
                      <Box key={i} className={styles.streamSkeletonRow}>
                        <Skeleton
                          loading
                          className={styles.streamSkeleton}
                          style={{ display: "block", height: 14 }}
                        />
                      </Box>
                    ))}
                  </Box>
                )}
                {items.length === 0 && !error && !loading && (
                  // Framed like the table, so the container keeps its outline
                  // when there are no rows to draw one.
                  <Box
                    className={clsx(
                      streamTableStyles.resultsPlaceholder,
                      styles.emptyFrame,
                    )}
                  >
                    <EmptyState
                      title="No evaluations found"
                      description={
                        isFiltered
                          ? "Try a different search, or clear it to see every evaluation in this window"
                          : "Try a longer time frame, or removing a filter"
                      }
                      leftButton={null}
                      rightButton={null}
                    />
                  </Box>
                )}

                {items.length > 0 && (
                  <>
                    {/* The same dense table as the Event Logs stream: list variant,
                  30px rows, 12px monospace cells that truncate rather than
                  wrap. The styling is shared rather than copied — see
                  components/Diagnostics/StreamTable.module.scss. */}
                    <Table
                      variant="list"
                      size="md"
                      className={clsx(
                        streamTableStyles.streamTable,
                        styles.evalTable,
                        columnWidths && styles.contentWidths,
                      )}
                    >
                      {/* Widths live on <col> in the cells' `ch`, so they track
                          the monospace font rather than guessed pixels. The
                          last col is unsized: it takes whatever the others
                          leave, so the table stays full width without opening
                          a gap between two columns. */}
                      {columnWidths && (
                        <colgroup>
                          {["timestamp", ...columns].map((key) => (
                            <col
                              key={key}
                              style={{
                                width: `calc(${columnWidths[key]}ch + 2 * var(--space-3) + ${STREAM_COLUMN_EXTRA_PX[key] ?? 0}px)`,
                              }}
                            />
                          ))}
                          <col />
                        </colgroup>
                      )}
                      <TableHeader>
                        <TableRow>
                          {/* Radix header cells, not the legacy `<th>` SortableTH
                        renders — the shared module's rules target
                        `.rt-TableColumnHeaderCell`. Same props, same sort UI.

                        Widths sit on the header only: under the shared fixed
                        layout the first row decides the columns. Columns given
                        no width share whatever is left, evenly. */}
                          <SortableTableColumnHeader
                            field="timestampSort"
                            style={
                              columnWidths
                                ? undefined
                                : { width: timestampPlan.width }
                            }
                          >
                            Timestamp
                          </SortableTableColumnHeader>
                          {columns.map((key) => (
                            <SortableTableColumnHeader
                              key={key}
                              field={key}
                              // Only `value` is pinned; everything else stays
                              // unsized and absorbs what Timestamp took.
                              style={
                                key === "value" && !columnWidths
                                  ? { width: VALUE_COLUMN_WIDTH }
                                  : undefined
                              }
                            >
                              {managedStream
                                ? managedStreamColumnLabel(key)
                                : streamColumnLabel(key)}
                            </SortableTableColumnHeader>
                          ))}
                          {columnWidths && <TableColumnHeader aria-hidden />}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {visibleItems.map((row) => (
                          <TableRow
                            key={row.id}
                            className={clsx(
                              styles.streamRow,
                              openRowId === row.id && styles.rowSelected,
                            )}
                            // The whole row opens the drawer. A click that
                            // ends a text selection does not: dragging across
                            // an id or rule name to copy it must not open it.
                            onClick={() => {
                              if (window.getSelection()?.toString()) return;
                              setOpenRowId(String(row.id));
                            }}
                          >
                            {/* Every column, not just the long ones: `value` holds
                            JSON on a non-boolean flag, and the timestamp clips
                            too once the card is narrow enough. */}
                            <TableCell>
                              {/* The keyboard way in (the row click is
                                  mouse-only). Positioned against the row, so
                                  it sits at the right edge whatever cell
                                  holds it; focusable while hidden, so Tab
                                  reaches it. */}
                              <button
                                type="button"
                                ref={(el) => {
                                  caretRefs.current[String(row.id)] = el;
                                }}
                                className={styles.openCaret}
                                aria-label="Open evaluation details"
                                aria-expanded={openRowId === row.id}
                                aria-controls={EVALUATION_DRAWER_ID}
                                onClick={(e) => {
                                  // The row's own click would do the same;
                                  // stop it so this opens exactly once.
                                  e.stopPropagation();
                                  setOpenRowId(String(row.id));
                                }}
                              >
                                <PiCaretRight size={12} aria-hidden />
                              </button>
                              <Skeleton
                                loading={loading}
                                className={styles.streamSkeleton}
                              >
                                <span className={styles.streamSkeletonCell}>
                                  <TruncatedCell
                                    value={String(row.timestamp)}
                                  />
                                </span>
                              </Skeleton>
                            </TableCell>
                            {columns.map((key) => (
                              <TableCell key={key}>
                                <Skeleton
                                  loading={loading}
                                  className={styles.streamSkeleton}
                                >
                                  <span className={styles.streamSkeletonCell}>
                                    {managedStream && key === "ruleId" ? (
                                      <RuleCell
                                        rawId={String(row[key] ?? "")}
                                        reference={resolveRuleCell(
                                          String(row[key] ?? ""),
                                        )}
                                      />
                                    ) : (
                                      <TruncatedCell
                                        value={String(row[key] ?? "")}
                                        // Identifiers differ at the end, so
                                        // the tail stays visible.
                                        truncate={
                                          managedStream && key === "unit_id"
                                            ? "middle"
                                            : "end"
                                        }
                                      />
                                    )}
                                  </span>
                                </Skeleton>
                              </TableCell>
                            ))}
                            {columnWidths && <TableCell aria-hidden />}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </>
                )}

                {/* Renders in the empty state too, so "No evaluations match"
                    sits where the count always is. */}
                {!error && (
                  <StreamPagination
                    numItemsTotal={items.length}
                    perPage={rowsPerPage}
                    setPerPage={setRowsPerPage}
                    currentPage={currentPage}
                    onPageChange={setPage}
                    pullBottom
                    summary={streamSummary}
                    hidePager={items.length === 0}
                  />
                )}
              </Box>
            </>
          )}
        </Frame>
      )}

      {/* With the shell's scrim, as in Event Logs: the page behind dims, and a
          click on it closes the drawer. */}
      <DetailDrawer
        open={!!openRow}
        onClose={closeDrawer}
        id={EVALUATION_DRAWER_ID}
        ariaLabel="Feature evaluation details"
        focusKey={openRowId}
        header={openRow ? <EvaluationHeader row={openRow} /> : null}
        footer={
          openRow ? (
            // Close alone, at the right edge (the footer spreads its children).
            <Flex ml="auto">
              <Button onClick={closeDrawer}>Close</Button>
            </Flex>
          ) : null
        }
      >
        {openRow ? (
          <EvaluationBody
            key={openRowId ?? undefined}
            row={openRow}
            onCopy={() => performCopy(rowJson(openRow))}
            copied={copySuccess}
            targetingKeys={targetingAttributeKeys(
              feature.rules ?? [],
              rowString(openRow, "environment"),
            )}
            ruleReference={resolveRuleCell(String(openRow.ruleId ?? ""))}
            variationText={
              rowString(openRow, "variationId")
                ? variationLabel(
                    String(openRow.ruleId ?? ""),
                    String(openRow.variationId ?? ""),
                  )
                : null
            }
          />
        ) : null}
      </DetailDrawer>
    </Box>
  );
}
