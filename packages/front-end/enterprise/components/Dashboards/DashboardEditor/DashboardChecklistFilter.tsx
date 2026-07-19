import { CSSProperties, ReactNode, useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretDown, PiCheck } from "react-icons/pi";
import Field from "@/components/Forms/Field";
import { Popover } from "@/ui/Popover";
import Button from "@/ui/Button";
import Checkbox from "@/ui/Checkbox";
import Text from "@/ui/Text";
import FilterCountBadge from "./FilterCountBadge";

export type ChecklistOption = { label: string; value: string };

interface Props {
  label: string;
  // When set, shown on the button instead of `label` (e.g. the chosen metric).
  selectedLabel?: string;
  // Truncate the button label to this width (px) with an ellipsis.
  maxLabelWidth?: number;
  icon?: ReactNode;
  options: ChecklistOption[];
  // Selected ids. Single-select callers pass [] or [id].
  value: string[];
  onChange: (values: string[]) => void;
  // When true, only one option can be selected at a time (radio-like).
  singleSelect?: boolean;
  // "checkbox": multi-select checkbox rows. "list": plain clickable rows with a
  // check on the selected one (for single-select menus).
  variant?: "checkbox" | "list";
  // Show a count badge on the button (defaults to true).
  showCount?: boolean;
  disabled?: boolean;
  searchPlaceholder?: string;
  emptyText?: string;
  // Extra styles merged into the trigger button (e.g. to strip its border and
  // radius when rendered as a segment of a joined control group).
  buttonStyle?: CSSProperties;
}

// A filter pill that opens a popover with a search box and an option list.
// Built from plain inputs (no react-select) so nothing floats outside the
// popover. Supports multi-select checkboxes (Projects) and single-select menus
// (Metrics).
export default function DashboardChecklistFilter({
  label,
  selectedLabel,
  maxLabelWidth,
  icon,
  options,
  value,
  onChange,
  singleSelect = false,
  variant = "checkbox",
  showCount = true,
  disabled,
  searchPlaceholder = "Search...",
  emptyText = "No results",
  buttonStyle,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, search]);

  const select = (id: string, checked: boolean) => {
    if (singleSelect) {
      // Selecting replaces the current choice; unchecking clears it. Close the
      // popover once a choice is made (nothing more to do for single-select).
      onChange(checked ? [id] : []);
      if (checked) setOpen(false);
      return;
    }
    onChange(checked ? [...value, id] : value.filter((v) => v !== id));
  };

  const triggerLabel = selectedLabel || label;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          icon={icon}
          iconPosition="left"
          style={{ justifyContent: "space-between", ...buttonStyle }}
        >
          <Flex align="center" gap="2">
            <span
              style={
                maxLabelWidth
                  ? {
                      maxWidth: maxLabelWidth,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }
                  : undefined
              }
              title={triggerLabel}
            >
              {triggerLabel}
            </span>
            {showCount && value.length > 0 ? (
              <FilterCountBadge count={value.length} />
            ) : null}
            <PiCaretDown aria-hidden />
          </Flex>
        </Button>
      }
      align="end"
      showArrow={false}
      contentStyle={{ padding: "12px", width: 280 }}
      content={
        <Flex direction="column" gap="2">
          <Field
            autoFocus
            containerClassName="mb-0"
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Box style={{ maxHeight: 260, overflowY: "auto", marginTop: 4 }}>
            {filtered.length === 0 ? (
              <Text size="small" color="text-low">
                {emptyText}
              </Text>
            ) : variant === "list" ? (
              <Flex direction="column">
                {filtered.map((o) => {
                  const selected = value.includes(o.value);
                  return (
                    <Flex
                      key={o.value}
                      align="center"
                      justify="between"
                      gap="2"
                      role="button"
                      tabIndex={0}
                      onClick={() => select(o.value, !selected)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          select(o.value, !selected);
                        }
                      }}
                      style={{
                        cursor: "pointer",
                        padding: "6px 8px",
                        borderRadius: "var(--radius-2)",
                        backgroundColor: selected
                          ? "var(--violet-a3)"
                          : undefined,
                      }}
                    >
                      <Text size="small" truncate>
                        {o.label}
                      </Text>
                      {selected ? (
                        <PiCheck
                          aria-hidden
                          style={{ color: "var(--violet-11)", flexShrink: 0 }}
                        />
                      ) : null}
                    </Flex>
                  );
                })}
              </Flex>
            ) : (
              <Flex direction="column" gap="2">
                {filtered.map((o) => (
                  <Checkbox
                    key={o.value}
                    size="sm"
                    weight="regular"
                    value={value.includes(o.value)}
                    setValue={(checked) => select(o.value, checked)}
                    label={o.label}
                  />
                ))}
              </Flex>
            )}
          </Box>
        </Flex>
      }
    />
  );
}
