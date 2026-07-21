import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Flex } from "@radix-ui/themes";
import { PiCaretRight } from "react-icons/pi";
import { Popover } from "@/ui/Popover";
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
} from "@/ui/Select";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Field from "@/components/Forms/Field";

// ---- Types ------------------------------------------------------------------

export type FilterOperator =
  | "equals"
  | "contains"
  | "starts_with"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "was_evaluated"
  | "was_exposed";

export type FilterCondition = {
  property: string;
  operator: FilterOperator;
  /** Empty string for presence-type properties (flags, experiments) */
  value: string;
};

type PropertyType = "string" | "number" | "enum" | "presence";

type PropertyDef = {
  id: string;
  label: string;
  type: PropertyType;
  operators: { value: FilterOperator; label: string }[];
  /** Only used when type === "enum" */
  enumOptions?: { value: string; label: string }[];
};

// ---- Static operator lists --------------------------------------------------

const EXACT_OPERATORS: PropertyDef["operators"] = [
  { value: "equals", label: "equals" },
];

const URL_OPERATORS: PropertyDef["operators"] = [
  { value: "contains", label: "contains" },
];

const NUMBER_OPERATORS: PropertyDef["operators"] = [
  { value: "equals", label: "=" },
  { value: "gte", label: ">=" },
  { value: "lte", label: "<=" },
];

// ---- Static property definitions -------------------------------------------

const SESSION_PROPERTIES: PropertyDef[] = [
  {
    id: "durationMs",
    label: "Duration (seconds)",
    type: "number",
    operators: NUMBER_OPERATORS,
  },
  {
    id: "eventCount",
    label: "Event count",
    type: "number",
    operators: NUMBER_OPERATORS,
  },
  {
    id: "url",
    label: "URL",
    type: "string",
    operators: URL_OPERATORS,
  },
];

const BASE_USER_PROPERTIES: PropertyDef[] = [
  {
    id: "userId",
    label: "User ID",
    type: "string",
    operators: EXACT_OPERATORS,
  },
  {
    id: "clientKey",
    label: "Client key",
    type: "string",
    operators: EXACT_OPERATORS,
  },
  {
    id: "country",
    label: "Country",
    type: "string",
    operators: EXACT_OPERATORS,
  },
  {
    id: "device",
    label: "Device type",
    type: "string",
    operators: [{ value: "equals", label: "equals" }],
  },
];

// ---- Component props --------------------------------------------------------

export type SessionForFilter = {
  featureKeys?: string[];
  experimentKeys?: string[];
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (condition: FilterCondition) => void;
  trigger: React.ReactNode;
  /** Pass loaded sessions to populate dynamic flag/experiment options */
  sessions?: SessionForFilter[];
}

// ---- Component --------------------------------------------------------------

export default function FilterQueryPopover({
  open,
  onOpenChange,
  onAdd,
  trigger,
  sessions = [],
}: Props) {
  const [property, setProperty] = useState<string>("");
  const [operator, setOperator] = useState<FilterOperator | "">("");
  const [value, setValue] = useState("");
  const valueInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Snapshot the session-derived options at safe points only (when the popover
  // opens, or after handleAdd resets the form). This prevents allProperties from
  // getting a new reference while a Select dropdown is open, which would corrupt
  // Radix's DismissableLayer context and cause the dropdown to close mid-use.
  const [uniqueFeatureKeys, setUniqueFeatureKeys] = useState<string[]>(() =>
    Array.from(new Set(sessions.flatMap((s) => s.featureKeys ?? []))).sort(),
  );
  const [uniqueExperimentKeys, setUniqueExperimentKeys] = useState<string[]>(
    () =>
      Array.from(
        new Set(sessions.flatMap((s) => s.experimentKeys ?? [])),
      ).sort(),
  );

  const snapshotSessions = useCallback((src: SessionForFilter[]) => {
    setUniqueFeatureKeys(
      Array.from(new Set(src.flatMap((s) => s.featureKeys ?? []))).sort(),
    );
    setUniqueExperimentKeys(
      Array.from(new Set(src.flatMap((s) => s.experimentKeys ?? []))).sort(),
    );
  }, []);

  // Sync snapshot when the popover opens (sessions may have changed while closed).
  const prevOpenRef = useRef(open);
  if (open && !prevOpenRef.current) {
    // Popover just transitioned to open — capture the latest sessions now.
    // Calling setState during render is React's idiomatic "derived state" pattern:
    // React re-renders synchronously with the new values before painting.
    prevOpenRef.current = open;
    snapshotSessions(sessions);
  } else {
    prevOpenRef.current = open;
  }

  const flagProperties: PropertyDef[] = useMemo(
    () =>
      uniqueFeatureKeys.map((key) => ({
        id: `featureKey:${key}`,
        label: `Flag: ${key}`,
        type: "presence",
        operators: [{ value: "was_evaluated", label: "was evaluated" }],
      })),
    [uniqueFeatureKeys],
  );

  const experimentProperties: PropertyDef[] = useMemo(
    () =>
      uniqueExperimentKeys.map((key) => ({
        id: `experimentKey:${key}`,
        label: `Exp: ${key}`,
        type: "presence",
        operators: [{ value: "was_exposed", label: "was exposed" }],
      })),
    [uniqueExperimentKeys],
  );

  // Build flat map of all property defs for quick lookup
  const allProperties: PropertyDef[] = useMemo(
    () => [
      ...SESSION_PROPERTIES,
      ...BASE_USER_PROPERTIES,
      ...flagProperties,
      ...experimentProperties,
    ],
    [experimentProperties, flagProperties],
  );

  const selectedDef = useMemo(
    () => allProperties.find((p) => p.id === property) ?? null,
    [allProperties, property],
  );
  const isPresence = selectedDef?.type === "presence";

  // canAdd: presence properties need property + operator; others also need value
  const canAdd = isPresence
    ? !!property && !!operator
    : !!property && !!operator && value.trim().length > 0;

  // Reset internal state when popover closes
  useEffect(() => {
    if (!open) {
      setProperty("");
      setOperator("");
      setValue("");
    }
  }, [open]);

  // Auto-select operator when there is exactly one option
  useEffect(() => {
    if (!selectedDef) return;
    if (selectedDef.operators.length === 1) {
      setOperator(selectedDef.operators[0].value);
    } else {
      setOperator("");
    }
    setValue("");
  }, [property, selectedDef]);

  // Focus value input once it appears
  useEffect(() => {
    if (operator && !isPresence) {
      setTimeout(() => valueInputRef.current?.focus(), 0);
    }
  }, [operator, isPresence]);

  const handleAdd = () => {
    if (!canAdd || !selectedDef) return;
    onAdd({
      property,
      operator: operator as FilterOperator,
      value: isPresence ? "" : value.trim(),
    });
    // Reset form so another condition can be added without closing the popover
    setProperty("");
    setOperator("");
    setValue("");
    // Refresh the options snapshot now that the form is reset and no dropdown
    // is open. The parent will soon refetch sessions with the new filter applied;
    // using the current (pre-refetch) sessions here is intentional — it ensures
    // the next dropdown renders stable children from the start.
    snapshotSessions(sessions);
  };

  const content = (
    <div ref={contentRef} style={{ width: 420 }}>
      <Text size="medium" weight="semibold" color="text-mid" as="div" mb="3">
        Add Filter Condition
      </Text>

      {/* Property → Operator → Value */}
      <Flex align="center" gap="2" wrap="wrap" mb="3">
        {/* Property select — grouped */}
        <Select
          value={property}
          setValue={setProperty}
          placeholder="Choose property..."
          size="small"
          container={contentRef.current}
          style={{ width: 185, flexShrink: 0 }}
        >
          <SelectGroup>
            <SelectLabel>SESSION</SelectLabel>
            {SESSION_PROPERTIES.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
          </SelectGroup>

          <SelectSeparator />

          <SelectGroup>
            <SelectLabel>USER ATTRIBUTES</SelectLabel>
            {BASE_USER_PROPERTIES.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
          </SelectGroup>

          {flagProperties.length > 0 && (
            <>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>FEATURE FLAGS</SelectLabel>
                {flagProperties.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </>
          )}

          {experimentProperties.length > 0 && (
            <>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>EXPERIMENTS</SelectLabel>
                {experimentProperties.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </>
          )}
        </Select>

        <PiCaretRight style={{ color: "var(--slate-a8)", flexShrink: 0 }} />

        {/* Operator select */}
        <Select
          value={operator}
          setValue={(v) => setOperator(v as FilterOperator)}
          placeholder="Operator..."
          size="small"
          disabled={!property}
          container={contentRef.current}
          style={{ width: 140, flexShrink: 0 }}
        >
          {(selectedDef?.operators ?? []).map((op) => (
            <SelectItem key={op.value} value={op.value}>
              {op.label}
            </SelectItem>
          ))}
        </Select>

        {/* Value input — not shown for presence-type or until operator is chosen */}
        {operator && !isPresence && (
          <>
            <PiCaretRight style={{ color: "var(--slate-a8)", flexShrink: 0 }} />
            {selectedDef?.type === "enum" ? (
              <Select
                value={value}
                setValue={setValue}
                placeholder="Choose value..."
                size="small"
                container={contentRef.current}
                style={{ width: 140, flexShrink: 0 }}
              >
                {(selectedDef.enumOptions ?? []).map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </Select>
            ) : (
              <Field
                ref={valueInputRef}
                type={selectedDef?.type === "number" ? "number" : "text"}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAdd();
                  }
                }}
                placeholder={
                  selectedDef?.type === "number" ? "0" : "Enter value..."
                }
                min={selectedDef?.type === "number" ? "0" : undefined}
                containerStyle={{ marginBottom: 0, width: 130, flexShrink: 0 }}
              />
            )}
          </>
        )}
      </Flex>

      {/* Add / Close */}
      <Flex gap="2" align="center" mb="2">
        <Button
          size="xs"
          variant="solid"
          disabled={!canAdd}
          onClick={handleAdd}
        >
          Add
        </Button>
        <Button size="xs" variant="outline" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      </Flex>

      {/* Keyboard hints */}
      <Flex align="center" gap="1">
        <Text size="small" color="text-low">
          Press
        </Text>
        <kbd
          style={{
            background: "var(--slate-a3)",
            padding: "1px 4px",
            borderRadius: 2,
            fontSize: 10,
            fontFamily: "inherit",
            color: "var(--slate-12)",
            fontWeight: 500,
            lineHeight: "16px",
          }}
        >
          Enter
        </kbd>
        <Text size="small" color="text-low">
          to add
        </Text>
        <Text size="small" color="text-low">
          ·
        </Text>
        <kbd
          style={{
            background: "var(--slate-a3)",
            padding: "1px 4px",
            borderRadius: 2,
            fontSize: 10,
            fontFamily: "inherit",
            color: "var(--slate-12)",
            fontWeight: 500,
            lineHeight: "16px",
          }}
        >
          Esc
        </kbd>
        <Text size="small" color="text-low">
          to cancel
        </Text>
      </Flex>
    </div>
  );

  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      trigger={trigger}
      content={content}
      align="start"
      side="bottom"
      showArrow={false}
      contentStyle={{ padding: 16 }}
      // Keeps popover open when Select portals steal focus/pointer events.
      disableDismiss
      onFocusOutside={(e) => e.preventDefault()}
    />
  );
}
