import { Fragment, ReactNode, useMemo, useRef, useState } from "react";
import type { EventLogSummaryItem } from "shared/validators";
import { Flex } from "@radix-ui/themes";
import {
  PiCalendarBlank,
  PiCaretDown,
  PiDatabase,
  PiCheck,
  PiPlus,
} from "react-icons/pi";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { useDefinitions } from "@/services/DefinitionsContext";
// Reused as-is from the dashboard filter bar: despite the name it takes no
// dashboard types, and omitting `onRemove` renders a permanent pill, which is
// what the time window needs. If this pattern spreads further, this component
// (with FilterCountBadge and DashboardControlPill.module.scss) should move to
// @/ui and lose the "Dashboard" prefix.
import DashboardChecklistFilter, {
  ChecklistOption,
} from "@/enterprise/components/Dashboards/DashboardEditor/DashboardChecklistFilter";
import styles from "./EventSummaryFilterBar.module.scss";
import { ARRIVAL_STATUS_LABELS, ArrivalStatus } from "./staleness";

/**
 * Optional filters, in the order they appear in the bar. The time window is
 * deliberately absent: it is permanent, always rendered first, and cannot be
 * added or removed — the same split the dashboard bar uses.
 */
export type EventFilterKey =
  | "environment"
  | "project"
  | "identifierType"
  | "usedBy"
  | "arrivalStatus"
  | "propertyValue";

/**
 * Rendered as groups, separated by a divider: scope filters first (which slice
 * of the org you are looking at), then the diagnostic ones (what the events
 * themselves look like). Property value sits in the second group but is gated
 * off by `applicability`, so it never renders.
 */
const FILTER_GROUPS: { key: EventFilterKey; label: string }[][] = [
  [
    { key: "project", label: "Project" },
    { key: "environment", label: "Environment" },
  ],
  [
    { key: "arrivalStatus", label: "Arrival Status" },
    { key: "identifierType", label: "Identifier Type" },
    { key: "usedBy", label: "Used by" },
    { key: "propertyValue", label: "Property value" },
  ],
];

export type TimeRangeOption = { label: string; hours: number };

/** What an event is referenced by, from the usedBy metadata lookup. */
export type UsedByFilter = "metric" | "factTable" | "nothing";

const USED_BY_LABELS: Record<UsedByFilter, string> = {
  metric: "A metric",
  factTable: "A Fact Table",
  nothing: "Nothing",
};

/** Identifier coverage is filtered as a boolean: has any, or has none. */
export type IdentifierCoverageFilter = "covered" | "empty";

interface Props {
  // Rendered at the head of the bar, before the time window pill, so the search
  // field shares the row with the filter controls.
  leading?: ReactNode;

  // Shown read-only to the left of the time window.
  dataSourceName: string;

  ranges: TimeRangeOption[];
  range: string;
  onRangeChange: (hours: string) => void;

  environments: string[];
  environment: string | null;
  onEnvironmentChange: (environment: string | null) => void;

  project: string | null;
  onProjectChange: (project: string | null) => void;

  // The fetched summary rows. Availability of the data-driven filters is
  // derived from these rather than hardcoded, so a filter appears exactly when
  // the endpoint returns the field that backs it.
  items: EventLogSummaryItem[];

  identifierType: string | null;
  onIdentifierTypeChange: (identifier: string | null) => void;

  usedBy: UsedByFilter | null;
  onUsedByChange: (usedBy: UsedByFilter | null) => void;

  arrivalStatus: ArrivalStatus | null;
  onArrivalStatusChange: (status: ArrivalStatus | null) => void;
}

export default function EventSummaryFilterBar({
  leading,
  dataSourceName,
  items,
  identifierType,
  onIdentifierTypeChange,
  usedBy,
  onUsedByChange,
  arrivalStatus,
  onArrivalStatusChange,
  ranges,
  range,
  onRangeChange,
  environments,
  environment,
  onEnvironmentChange,
  project,
  onProjectChange,
}: Props) {
  const { projects } = useDefinitions();

  // Filters the user added this session. A filter with a value is always shown,
  // so a pill stays visible after a reload even if it was never "added" here.
  const [addedKeys, setAddedKeys] = useState<EventFilterKey[]>([]);
  const [autoOpenKey, setAutoOpenKey] = useState<EventFilterKey | null>(null);
  // Set when a filter was picked rather than the menu being dismissed, so the
  // close handler leaves focus for that filter's popover.
  const addedFilterRef = useRef(false);

  const valueFor = (key: EventFilterKey) => {
    if (key === "environment") return environment;
    if (key === "project") return project;
    if (key === "identifierType") return identifierType;
    if (key === "usedBy") return usedBy;
    if (key === "arrivalStatus") return arrivalStatus;
    return null;
  };

  const isVisible = (key: EventFilterKey) =>
    addedKeys.includes(key) || valueFor(key) !== null;

  // Identifier columns present across the fetched rows, in the order the
  // endpoint reports them.
  const identifierNames = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of items) {
      for (const coverage of item.identifierCoverage ?? []) {
        if (seen.has(coverage.identifier)) continue;
        seen.add(coverage.identifier);
        out.push(coverage.identifier);
      }
    }
    return out;
  }, [items]);

  // Derived, not hardcoded: each filter is offered exactly when the field that
  // backs it is present on the response. Property value has no field and is
  // deliberately out of scope.
  const applicability: Record<EventFilterKey, boolean> = {
    environment: environments.length > 0,
    project: projects.length > 0,
    identifierType: identifierNames.length > 0,
    usedBy: items.some((i) => i.usedBy !== undefined),
    arrivalStatus: items.some((i) => i.lastReceived !== undefined),
    propertyValue: false,
  };

  const environmentOptions: ChecklistOption[] = useMemo(
    () => environments.map((e) => ({ label: e, value: e })),
    [environments],
  );

  const projectOptions: ChecklistOption[] = useMemo(
    () => projects.map((p) => ({ label: p.name, value: p.id })),
    [projects],
  );

  // "Covered" / "No coverage" per identifier: the pill picks the identifier,
  // and the value encodes which side of zero coverage to keep.
  const identifierTypeOptions: ChecklistOption[] = useMemo(
    () =>
      identifierNames.flatMap((name) => [
        { label: `${name} — has coverage`, value: `${name}:covered` },
        { label: `${name} — no coverage`, value: `${name}:empty` },
      ]),
    [identifierNames],
  );

  const usedByOptions: ChecklistOption[] = (
    Object.keys(USED_BY_LABELS) as UsedByFilter[]
  ).map((key) => ({ label: USED_BY_LABELS[key], value: key }));

  const arrivalStatusOptions: ChecklistOption[] = (
    Object.keys(ARRIVAL_STATUS_LABELS) as ArrivalStatus[]
  ).map((key) => ({ label: ARRIVAL_STATUS_LABELS[key], value: key }));

  const rangeLabel =
    ranges.find((r) => String(r.hours) === range)?.label ?? "Time window";

  const remove = (key: EventFilterKey) => {
    setAddedKeys((keys) => keys.filter((k) => k !== key));
    if (key === "environment") onEnvironmentChange(null);
    if (key === "project") onProjectChange(null);
    if (key === "identifierType") onIdentifierTypeChange(null);
    if (key === "usedBy") onUsedByChange(null);
    if (key === "arrivalStatus") onArrivalStatusChange(null);
  };

  const canClear =
    addedKeys.length > 0 ||
    environment !== null ||
    project !== null ||
    identifierType !== null ||
    usedBy !== null ||
    arrivalStatus !== null;

  const clearAll = () => {
    setAddedKeys([]);
    setAutoOpenKey(null);
    onEnvironmentChange(null);
    onProjectChange(null);
    onIdentifierTypeChange(null);
    onUsedByChange(null);
    onArrivalStatusChange(null);
    // The window is permanent, but Clear All still returns it to the default
    // rather than leaving a stale selection behind.
    onRangeChange(String(ranges[Math.min(2, ranges.length - 1)].hours));
  };

  // A plain single-select menu, not a DashboardChecklistFilter: for four fixed
  // ranges that component's popover adds a header, an autofocus search box and a
  // separator, which is more chrome than the choice needs. The trigger still
  // mirrors the funnel page's "Past 30 days" button.
  const rangeMenu = (
    <DropdownMenu
      menuPlacement="end"
      menuWidth={200}
      // Soft item highlight instead of Radix's solid accent fill.
      variant="soft"
      trigger={
        <Button
          className={styles.dateRangePill}
          variant="outline"
          color="gray"
          size="md"
          icon={
            // Same token the read-only data source pill uses, so the two icons
            // in this row read as one set rather than two grays.
            <PiCalendarBlank
              aria-hidden
              style={{ color: "var(--color-text-mid)" }}
            />
          }
          iconPosition="left"
          style={{ justifyContent: "space-between" }}
        >
          <Flex align="center" gap="2" justify="between" width="100%">
            <span
              style={{
                // Absorb the slack so the label hugs the icon; without this
                // justify="between" spreads it toward the middle.
                flexGrow: 1,
                minWidth: 0,
                textAlign: "left",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                // The selected value, not chrome: brighter than the gray the
                // Button's color="gray" gives the icon and caret. 400 is what
                // --font-weight-regular resolves to; it has to be the literal
                // because React's CSSProperties rejects a var() for fontWeight.
                // Overrides the medium that @/ui/Button wraps children in.
                color: "var(--color-text-high)",
                fontWeight: 400,
              }}
            >
              {rangeLabel}
            </span>
            <PiCaretDown aria-hidden style={{ flexShrink: 0 }} />
          </Flex>
        </Button>
      }
    >
      {ranges.map((r) => {
        const isSelected = String(r.hours) === range;
        return (
          <DropdownMenuItem
            key={r.hours}
            onClick={() => onRangeChange(String(r.hours))}
          >
            <Flex align="center" justify="between" gap="4" width="100%">
              <span style={{ color: "var(--color-text-high)" }}>{r.label}</span>
              {isSelected ? <PiCheck aria-hidden /> : null}
            </Flex>
          </DropdownMenuItem>
        );
      })}
    </DropdownMenu>
  );

  const addFilterMenu = (
    <DropdownMenu
      menuPlacement="start"
      menuWidth={240}
      variant="soft"
      onCloseAutoFocus={(e) => {
        if (!addedFilterRef.current) return;
        addedFilterRef.current = false;
        e.preventDefault();
      }}
      trigger={
        <Button
          variant="ghost"
          size="sm"
          icon={<PiPlus aria-hidden />}
          iconPosition="left"
        >
          Add Filter
        </Button>
      }
    >
      {/* The menu only ever lists filters you can actually add: unsupported
          ones are left out, and an added one disappears until it is removed
          from the bar. Nothing here is rendered disabled.

          Empty groups are dropped before the separator is placed, so a divider
          can never end up leading, trailing, or doubled. */}
      {FILTER_GROUPS.map((group) =>
        group.filter(
          (filter) => applicability[filter.key] && !isVisible(filter.key),
        ),
      )
        .filter((group) => group.length > 0)
        .map((group, groupIndex) => (
          <Fragment key={group[0].key}>
            {groupIndex > 0 ? <DropdownMenuSeparator /> : null}
            {group.map((filter) => (
              <DropdownMenuItem
                key={filter.key}
                onClick={() => {
                  addedFilterRef.current = true;
                  setAddedKeys((keys) => [...keys, filter.key]);
                  setAutoOpenKey(filter.key);
                }}
              >
                {filter.label}
              </DropdownMenuItem>
            ))}
          </Fragment>
        ))}
    </DropdownMenu>
  );

  return (
    <Flex direction="column" gap="3">
      {/* Row 1: search on the left, the permanent time window pinned to the
          right edge so it lines up with the table below. */}
      <Flex align="center" gap="2" justify="between" wrap="wrap">
        {leading}

        {/* 16px between the data source and the time window. */}
        <Flex align="center" gap="4" wrap="wrap">
          {/* Read-only: scope, not a filter. Events are only ever read from the
              org's single managed warehouse, so there is nothing to choose. */}
          <Flex
            className={styles.readOnlyPill}
            title={`Data source: ${dataSourceName}`}
          >
            <PiDatabase aria-hidden style={{ flexShrink: 0 }} />
            <Text size="sm" color="text-mid">
              {dataSourceName}
            </Text>
          </Flex>

          {rangeMenu}
        </Flex>
      </Flex>

      {/* Row 2: the optional filters. 4px between the Add Filter button and the
          pill group, 8px between the pills themselves. */}
      <Flex align="center" gap="2" justify="between" wrap="wrap">
        <Flex align="center" gap="1" wrap="wrap">
          {addFilterMenu}

          <Flex align="center" gap="2" wrap="wrap">
            {isVisible("environment") ? (
              <DashboardChecklistFilter
                label="Environment"
                options={environmentOptions}
                value={environment ? [environment] : []}
                onChange={(values) => onEnvironmentChange(values[0] ?? null)}
                onRemove={() => remove("environment")}
                autoOpen={autoOpenKey === "environment"}
                singleSelect
                variant="list"
                size="sm"
                className={styles.compactPill}
                searchPlaceholder="Search environments..."
                emptyText="No environments found"
              />
            ) : null}

            {isVisible("project") ? (
              <DashboardChecklistFilter
                label="Project"
                options={projectOptions}
                value={project ? [project] : []}
                onChange={(values) => onProjectChange(values[0] ?? null)}
                onRemove={() => remove("project")}
                autoOpen={autoOpenKey === "project"}
                singleSelect
                variant="list"
                size="sm"
                className={styles.compactPill}
                searchPlaceholder="Search projects..."
                emptyText="No Projects found"
              />
            ) : null}

            {isVisible("identifierType") ? (
              <DashboardChecklistFilter
                label="Identifier Type"
                options={identifierTypeOptions}
                value={identifierType ? [identifierType] : []}
                onChange={(values) => onIdentifierTypeChange(values[0] ?? null)}
                onRemove={() => remove("identifierType")}
                autoOpen={autoOpenKey === "identifierType"}
                singleSelect
                variant="list"
                size="sm"
                className={styles.compactPill}
                searchPlaceholder="Search identifiers..."
                emptyText="No identifiers found"
              />
            ) : null}

            {isVisible("usedBy") ? (
              <DashboardChecklistFilter
                label="Used by"
                options={usedByOptions}
                value={usedBy ? [usedBy] : []}
                onChange={(values) =>
                  onUsedByChange((values[0] as UsedByFilter) ?? null)
                }
                onRemove={() => remove("usedBy")}
                autoOpen={autoOpenKey === "usedBy"}
                singleSelect
                variant="list"
                size="sm"
                className={styles.compactPill}
                showCount={false}
              />
            ) : null}

            {isVisible("arrivalStatus") ? (
              <DashboardChecklistFilter
                label="Arrival Status"
                options={arrivalStatusOptions}
                value={arrivalStatus ? [arrivalStatus] : []}
                onChange={(values) =>
                  onArrivalStatusChange((values[0] as ArrivalStatus) ?? null)
                }
                onRemove={() => remove("arrivalStatus")}
                autoOpen={autoOpenKey === "arrivalStatus"}
                singleSelect
                variant="list"
                size="sm"
                className={styles.compactPill}
                showCount={false}
              />
            ) : null}
          </Flex>
        </Flex>

        {canClear ? (
          <Link onClick={clearAll} className={styles.clearAll}>
            Clear All
          </Link>
        ) : null}
      </Flex>
    </Flex>
  );
}
