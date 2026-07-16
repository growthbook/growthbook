import React, { ReactNode, useState, useRef, useEffect } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { format } from "date-fns";
import { dateRangePredefined, lookbackUnit } from "shared/validators";
import type { ExplorationDateRange } from "shared/validators";
import { getValidDateOffsetByUTC } from "shared/dates";
import { Select, SelectItem } from "@/ui/Select";
import Text from "@/ui/Text";
import Field from "@/components/Forms/Field";
import DatePicker from "@/components/DatePicker";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import {
  DATE_RANGE_PREDEFINED_LABELS,
  LOOKBACK_UNIT_LABELS,
} from "@/enterprise/components/ProductAnalytics/dateRangeLabels";
import { useMergedDateRangeUpdates } from "./useMergedDateRangeUpdates";

const DATE_RANGE_INPUT_STYLE: React.CSSProperties = {
  backgroundColor: "transparent",
};

function MicroLabel({ children }: { children: ReactNode }) {
  return (
    <Text size="small" color="text-low" weight="regular">
      {children}
    </Text>
  );
}

/** Preset dropdown ("Custom Date Range" etc.) plus the custom-lookback inputs. */
function DateRangePresetSelect({
  value,
  onChange,
  disabled,
  fullWidth = false,
}: {
  value: ExplorationDateRange;
  onChange: (dateRange: ExplorationDateRange) => void;
  disabled?: boolean;
  /** Stretch the preset dropdown to 100% and lay the lookback # + unit in a row. */
  fullWidth?: boolean;
}) {
  const [localLookbackValue, setLocalLookbackValue] = useState<string | null>(
    null,
  );
  const latestLookbackRef = useRef<string>("");
  const skipBlurCommitRef = useRef(false);

  useEffect(() => {
    if (value.predefined !== "customLookback") {
      setLocalLookbackValue(null);
      latestLookbackRef.current = "";
    }
  }, [value.predefined]);

  const commitLookbackValue = (lookbackValue: string) => {
    const parsed = lookbackValue ? parseInt(lookbackValue, 10) : null;
    const isValid = parsed !== null && parsed >= 1 && !Number.isNaN(parsed);

    if (!isValid) {
      setLocalLookbackValue(null);
      latestLookbackRef.current = "";
      return;
    }

    onChange({
      ...value,
      lookbackValue: parsed,
      lookbackUnit: value.lookbackUnit || "day",
    });
    setLocalLookbackValue(null);
    latestLookbackRef.current = "";
  };

  const activeDateRange = value;
  const lookbackNumberField = (
    <Field
      type="number"
      style={{
        width: "55px",
        paddingTop: "0px",
        paddingBottom: "0px",
        height: "32px",
      }}
      placeholder="#"
      min="1"
      disabled={disabled}
      value={
        localLookbackValue !== null
          ? localLookbackValue
          : activeDateRange.lookbackValue?.toString() || ""
      }
      onFocus={() => {
        latestLookbackRef.current =
          activeDateRange.lookbackValue?.toString() || "";
      }}
      onChange={(e) => {
        const v = e.target.value;
        latestLookbackRef.current = v;
        setLocalLookbackValue(v);
      }}
      onBlur={() => {
        if (skipBlurCommitRef.current) {
          skipBlurCommitRef.current = false;
          return;
        }
        const toCommit = latestLookbackRef.current;
        commitLookbackValue(toCommit);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          const toCommit =
            latestLookbackRef.current ||
            activeDateRange.lookbackValue?.toString() ||
            "";
          commitLookbackValue(toCommit);
          skipBlurCommitRef.current = true;
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );

  const lookbackUnitSelect = (
    <Select
      size="2"
      style={fullWidth ? { width: "100%" } : undefined}
      value={activeDateRange.lookbackUnit || "day"}
      disabled={disabled}
      setValue={(v) => {
        onChange({
          ...activeDateRange,
          lookbackUnit: v as (typeof lookbackUnit)[number],
        });
      }}
    >
      {lookbackUnit.map((u) => (
        <SelectItem key={u} value={u}>
          {LOOKBACK_UNIT_LABELS[u]}
        </SelectItem>
      ))}
    </Select>
  );

  const presetSelect = (
    <Select
      size="2"
      style={fullWidth ? { width: "100%" } : undefined}
      value={value.predefined}
      placeholder="Select range"
      disabled={disabled}
      setValue={(v) => {
        const predefined = v as (typeof dateRangePredefined)[number];
        onChange({
          ...activeDateRange,
          predefined,
          ...(predefined === "customLookback"
            ? {
                lookbackValue: activeDateRange.lookbackValue || 30,
                lookbackUnit: activeDateRange.lookbackUnit || "day",
              }
            : {}),
          ...(predefined === "customDateRange"
            ? {
                startDate:
                  activeDateRange.startDate ?? format(new Date(), "yyyy-MM-dd"),
                endDate:
                  activeDateRange.endDate ?? format(new Date(), "yyyy-MM-dd"),
              }
            : {}),
        });
      }}
    >
      {dateRangePredefined.map((option) => (
        <SelectItem key={option} value={option}>
          {DATE_RANGE_PREDEFINED_LABELS[option]}
        </SelectItem>
      ))}
    </Select>
  );

  const isCustomLookback = value.predefined === "customLookback";

  if (fullWidth) {
    // Custom Lookback keeps the preset dropdown, number, and unit on one row
    // (preset widest, number compact, unit moderate); other presets are just
    // the full-width dropdown.
    if (isCustomLookback) {
      return (
        <Flex gap="2" align="center" width="100%">
          <Box style={{ flex: 2, minWidth: 0 }}>{presetSelect}</Box>
          {lookbackNumberField}
          <Box style={{ flex: 1, minWidth: 0 }}>{lookbackUnitSelect}</Box>
        </Flex>
      );
    }
    return presetSelect;
  }

  return (
    <>
      {presetSelect}
      {isCustomLookback && (
        <>
          {lookbackNumberField}
          {lookbackUnitSelect}
        </>
      )}
    </>
  );
}

/** The "Current" custom date range field (label + range picker). */
function CurrentCustomRangeField({
  value,
  onChange,
  disabled,
  shouldWrap = false,
  label,
  fullWidth = false,
}: {
  value: ExplorationDateRange;
  onChange: (dateRange: ExplorationDateRange) => void;
  disabled?: boolean;
  shouldWrap?: boolean;
  /** Micro-label shown before the custom date range field (e.g. "Current"). */
  label?: ReactNode;
  /** Render as a single full-width range field (no label) that fills its cell. */
  fullWidth?: boolean;
}) {
  const updateDateRange = useMergedDateRangeUpdates(value, onChange);

  if (value.predefined !== "customDateRange") return null;

  const picker = (
    <DatePicker
      containerClassName="mb-0"
      compact
      wrapRangeInputs={fullWidth ? false : shouldWrap}
      disabled={disabled}
      inputStyle={DATE_RANGE_INPUT_STYLE}
      date={
        value.startDate ? getValidDateOffsetByUTC(value.startDate) : undefined
      }
      date2={value.endDate ? getValidDateOffsetByUTC(value.endDate) : undefined}
      setDate={(d) => {
        updateDateRange({
          startDate: d ? format(d, "yyyy-MM-dd") : null,
        });
      }}
      setDate2={(d) => {
        updateDateRange({
          endDate: d ? format(d, "yyyy-MM-dd") : null,
        });
      }}
      precision="date"
    />
  );

  if (fullWidth) {
    return (
      <Box width="100%" style={{ minWidth: 0 }}>
        {picker}
      </Box>
    );
  }

  return (
    <>
      {label && <MicroLabel>{label}</MicroLabel>}
      {picker}
    </>
  );
}

export interface ControlledDateRangePickerProps {
  value: ExplorationDateRange;
  onChange: (dateRange: ExplorationDateRange) => void;
  disabled?: boolean;
  shouldWrap?: boolean;
  /** Micro-label shown before the custom date range field (e.g. "Current"). */
  label?: ReactNode;
  /** Stack the preset dropdown and date field vertically, each spanning 100%. */
  fullWidth?: boolean;
}

export function ControlledDateRangePicker({
  value,
  onChange,
  disabled,
  shouldWrap = false,
  label,
  fullWidth = false,
}: ControlledDateRangePickerProps) {
  if (fullWidth) {
    return (
      <Flex direction="column" gap="2" width="100%" style={{ minWidth: 0 }}>
        <DateRangePresetSelect
          value={value}
          onChange={onChange}
          disabled={disabled}
          fullWidth
        />
        <CurrentCustomRangeField
          value={value}
          onChange={onChange}
          disabled={disabled}
          fullWidth
        />
      </Flex>
    );
  }
  return (
    <Flex
      align="center"
      gap="2"
      wrap={shouldWrap ? "wrap" : undefined}
      width={shouldWrap ? "100%" : undefined}
      style={shouldWrap ? { minWidth: 0 } : undefined}
    >
      <DateRangePresetSelect
        value={value}
        onChange={onChange}
        disabled={disabled}
      />
      <CurrentCustomRangeField
        value={value}
        onChange={onChange}
        disabled={disabled}
        shouldWrap={shouldWrap}
        label={label}
      />
    </Flex>
  );
}

function ExplorerDateRangePresetSelect({
  fullWidth = false,
}: {
  /** Stretch the preset dropdown to 100% and lay the lookback # + unit in a row. */
  fullWidth?: boolean;
}) {
  const { draftExploreState, setDraftExploreState } = useExplorerContext();

  return (
    <DateRangePresetSelect
      value={draftExploreState.dateRange}
      onChange={(dateRange) => {
        setDraftExploreState((prev) => ({
          ...prev,
          dateRange,
        }));
      }}
      fullWidth={fullWidth}
    />
  );
}

function ExplorerCurrentCustomRangeField({
  shouldWrap = false,
  label,
  fullWidth = false,
}: {
  shouldWrap?: boolean;
  /** Micro-label shown before the custom date range field (e.g. "Current"). */
  label?: ReactNode;
  /** Render as a single full-width range field (no label) that fills its cell. */
  fullWidth?: boolean;
}) {
  const { draftExploreState, setDraftExploreState } = useExplorerContext();

  return (
    <CurrentCustomRangeField
      value={draftExploreState.dateRange}
      onChange={(dateRange) =>
        setDraftExploreState((prev) => ({
          ...prev,
          dateRange,
        }))
      }
      shouldWrap={shouldWrap}
      label={label}
      fullWidth={fullWidth}
    />
  );
}

function ComparisonPreviousRangePicker({
  shouldWrap = false,
  label,
  fullWidth = false,
}: {
  shouldWrap?: boolean;
  /** Micro-label shown before the prior date range field (e.g. "Prior"). */
  label?: ReactNode;
  /** Render as a single full-width range field (no label) that fills its cell. */
  fullWidth?: boolean;
}) {
  const { draftExploreState, setDraftExploreState, compareEnabled } =
    useExplorerContext();

  const previousTimeFrame = draftExploreState.previousTimeFrame;
  const dr = draftExploreState.dateRange;

  if (
    !compareEnabled ||
    dr.predefined !== "customDateRange" ||
    !dr.startDate ||
    !dr.endDate ||
    !previousTimeFrame ||
    !previousTimeFrame.startDate ||
    !previousTimeFrame.endDate
  ) {
    return null;
  }

  const picker = (
    <DatePicker
      containerClassName="mb-0"
      compact
      wrapRangeInputs={fullWidth ? false : shouldWrap}
      inputStyle={DATE_RANGE_INPUT_STYLE}
      date={getValidDateOffsetByUTC(previousTimeFrame.startDate)}
      date2={getValidDateOffsetByUTC(previousTimeFrame.endDate)}
      setDate={(d) => {
        setDraftExploreState((prev) => ({
          ...prev,
          previousTimeFrame: prev.previousTimeFrame
            ? {
                ...prev.previousTimeFrame,
                predefined: "customDateRange" as const,
                startDate: d ? format(d, "yyyy-MM-dd") : null,
              }
            : prev.previousTimeFrame,
        }));
      }}
      setDate2={(d) => {
        setDraftExploreState((prev) => ({
          ...prev,
          previousTimeFrame: prev.previousTimeFrame
            ? {
                ...prev.previousTimeFrame,
                predefined: "customDateRange" as const,
                endDate: d ? format(d, "yyyy-MM-dd") : null,
              }
            : prev.previousTimeFrame,
        }));
      }}
      precision="date"
    />
  );

  if (fullWidth) {
    return (
      <Box width="100%" style={{ minWidth: 0 }}>
        {picker}
      </Box>
    );
  }

  return (
    <Flex
      align="center"
      gap="2"
      wrap={shouldWrap ? "wrap" : undefined}
      width={shouldWrap ? "100%" : undefined}
      style={{ minWidth: 0 }}
    >
      {label && <MicroLabel>{label}</MicroLabel>}
      {picker}
    </Flex>
  );
}

export interface DateRangePickerProps {
  shouldWrap?: boolean;
  /** Micro-label shown before the date range field (e.g. "Current" / "Prior"). */
  label?: ReactNode;
  /** Stack the preset dropdown and date field vertically, each spanning 100%. */
  fullWidth?: boolean;
}

export default function DateRangePicker({
  shouldWrap = false,
  label,
  fullWidth = false,
}: DateRangePickerProps = {}) {
  const { draftExploreState, setDraftExploreState } = useExplorerContext();

  return (
    <ControlledDateRangePicker
      value={draftExploreState.dateRange}
      onChange={(dateRange) => {
        setDraftExploreState((prev) => ({
          ...prev,
          dateRange,
        }));
      }}
      shouldWrap={shouldWrap}
      label={label}
      fullWidth={fullWidth}
    />
  );
}

/**
 * "Current" / "Prior" label that hugs its date field, and drops out entirely on
 * small screens (the "vs" still anchors the two rows) to reclaim horizontal
 * space.
 */
function CompareFieldLabel({ children }: { children: ReactNode }) {
  return (
    <Box display={{ initial: "none", sm: "inline-block" }}>
      <Text size="small" color="text-low" weight="medium">
        {children}
      </Text>
    </Box>
  );
}

/**
 * Compare-on controls for the custom date range. Returns a flat fragment of
 * items (dropdown, Current, vs, Prior, group-by) so they sit directly in the
 * toolbar's right-aligned wrapping row alongside the Compare switch — each label
 * stays paired with its date field so the two never split across a line break.
 */
export function ComparisonDateControls({
  groupBySlot,
  fullWidth = false,
}: {
  /** Optional group-by control rendered alongside the prior picker. */
  groupBySlot?: ReactNode;
  /**
   * Full-width layout: the preset dropdown spans 100%, then Prior and Current
   * stack as `100px 1fr` rows (fixed label column + single-line range field
   * that truncates to fit), with `vs` between them. Prior sits above Current.
   */
  fullWidth?: boolean;
}) {
  if (fullWidth) {
    // Fixed 100px label column; the field column shrinks/truncates rather than
    // forcing width (minmax(0, …) overrides the grid item's min-content floor).
    const labeledRow = (label: string, field: ReactNode) => (
      <Box
        style={{
          display: "grid",
          gridTemplateColumns: "100px minmax(0, 1fr)",
          alignItems: "center",
          columnGap: "var(--space-2)",
        }}
      >
        <MicroLabel>{label}</MicroLabel>
        {field}
      </Box>
    );
    return (
      <Flex direction="column" gap="2" width="100%" style={{ minWidth: 0 }}>
        <ExplorerDateRangePresetSelect fullWidth />
        <Flex direction="column" gap="1" width="100%" style={{ minWidth: 0 }}>
          {labeledRow("Prior", <ComparisonPreviousRangePicker fullWidth />)}
          {labeledRow(
            "",
            <Text size="small" weight="semibold">
              vs
            </Text>,
          )}
          {labeledRow("Current", <ExplorerCurrentCustomRangeField fullWidth />)}
        </Flex>
        {groupBySlot}
      </Flex>
    );
  }
  return (
    <>
      <ExplorerDateRangePresetSelect />
      <Flex align="center" gap="2">
        <CompareFieldLabel>Current</CompareFieldLabel>
        <ExplorerCurrentCustomRangeField />
      </Flex>
      <Text size="small" color="text-low" weight="medium">
        vs
      </Text>
      <Flex align="center" gap="2">
        <CompareFieldLabel>Prior</CompareFieldLabel>
        <ComparisonPreviousRangePicker />
      </Flex>
      {groupBySlot}
    </>
  );
}
