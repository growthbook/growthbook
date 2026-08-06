import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Box, Flex, IconButton, Separator } from "@radix-ui/themes";
import { PiCaretDown, PiCheck, PiX } from "react-icons/pi";
import Field from "@/components/Forms/Field";
import { Popover } from "@/ui/Popover";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import Checkbox from "@/ui/Checkbox";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import FilterCountBadge from "./FilterCountBadge";
import styles from "./DashboardControlPill.module.scss";

export type ChecklistOption = {
  // Plain-text label. Also what the popover's search box matches against.
  label: string;
  value: string;
  // Rendered instead of `label` when the option needs decoration (e.g. a Tag
  // with its color dot). Searching still uses `label`.
  node?: ReactNode;
  // Shown greyed out and not selectable (e.g. a metric no experiment uses).
  disabled?: boolean;
};

interface Props {
  label: string;
  icon?: ReactNode;
  options: ChecklistOption[];
  // Selected ids. Single-select callers pass [] or [id].
  value: string[];
  onChange: (values: string[]) => void;
  // Clears the filter and takes it out of the bar. Given the ✕ on the pill; when
  // omitted the pill is permanent and shows a caret instead.
  onRemove?: () => void;
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
  // Open the popover on its own once this is true (used when the filter was just
  // added from the "Add filter" menu, so the user can pick a value right away).
  autoOpen?: boolean;
}

// A filter pill that opens a popover with a search box and an option list.
// Built from plain inputs (no react-select) so nothing floats outside the
// popover. Supports multi-select checkboxes (Projects) and single-select menus
// (Metrics).
export default function DashboardChecklistFilter({
  label,
  icon,
  options,
  value,
  onChange,
  onRemove,
  singleSelect = false,
  variant = "checkbox",
  showCount = true,
  disabled,
  searchPlaceholder = "Search...",
  emptyText = "No results",
  autoOpen = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Auto-opening happens while the "Add filter" menu is still tearing down, and
  // its teardown emits focus/pointer events outside this popover that Radix would
  // otherwise treat as "dismiss me". Ignore those for a beat after opening.
  const settlingRef = useRef(false);
  useEffect(() => {
    if (!autoOpen) return;
    settlingRef.current = true;
    setOpen(true);
    const timer = setTimeout(() => {
      settlingRef.current = false;
    }, 400);
    return () => clearTimeout(timer);
  }, [autoOpen]);

  // Swallow a dismiss that's really just the menu handing off.
  const keepOpenWhileSettling = (e: { preventDefault: () => void }) => {
    if (settlingRef.current) e.preventDefault();
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, search]);

  // Selected values in selection order. A value with no matching option (e.g. a
  // saved id that no longer exists) still gets a chip so it can be removed.
  const selectedOptions = useMemo(
    () =>
      value.map(
        (v) => options.find((o) => o.value === v) ?? { label: v, value: v },
      ),
    [value, options],
  );

  const select = (id: string, checked: boolean, disabled?: boolean) => {
    if (disabled) return;
    if (singleSelect) {
      // Selecting replaces the current choice; unchecking clears it. Close the
      // popover once a choice is made (nothing more to do for single-select).
      onChange(checked ? [id] : []);
      if (checked) setOpen(false);
      return;
    }
    onChange(checked ? [...value, id] : value.filter((v) => v !== id));
  };

  // Multi-select filters echo their selection as removable chips above the list,
  // so the current filter is readable without scrolling the options.
  const showChips = !singleSelect && selectedOptions.length > 0;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button
          variant="outline"
          color="gray"
          size="md"
          className={styles.controlPill}
          disabled={disabled}
          icon={icon}
          iconPosition="left"
          style={{ justifyContent: "space-between" }}
        >
          <Flex align="center" gap="2">
            <span style={{ whiteSpace: "nowrap" }}>{label}</span>
            {showCount && value.length > 0 ? (
              <FilterCountBadge count={value.length} />
            ) : null}
            {onRemove ? (
              // A span rather than a button: the pill itself is the popover
              // trigger, and a button can't nest inside another button.
              <span
                role="button"
                tabIndex={0}
                aria-label={`Remove ${label} filter`}
                title={`Remove ${label} filter`}
                className={styles.pillRemove}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onRemove();
                }}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" && e.key !== " ") return;
                  e.preventDefault();
                  e.stopPropagation();
                  onRemove();
                }}
              >
                <PiX aria-hidden />
              </span>
            ) : (
              <PiCaretDown aria-hidden />
            )}
          </Flex>
        </Button>
      }
      align="start"
      showArrow={false}
      onInteractOutside={keepOpenWhileSettling}
      onFocusOutside={keepOpenWhileSettling}
      // Fixed widths, never content-driven: a multi-select popover would
      // otherwise resize as chips are added and removed. Multi-select is wider to
      // fit the chip row and footer; single-select is just a list.
      contentStyle={{ padding: "12px", width: singleSelect ? 280 : 320 }}
      content={
        <Flex direction="column" gap="2">
          {/* Letter spacing lives on the Box: @/ui/Text takes no style prop. */}
          <Box style={{ letterSpacing: "0.06em" }}>
            <Text size="sm" color="text-low" textTransform="uppercase">
              {`${label} · ${options.length} available`}
            </Text>
          </Box>
          <Field
            autoFocus
            containerClassName="mb-0"
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {showChips ? (
            <Flex wrap="wrap" gap="1">
              {selectedOptions.map((o) => (
                <Badge
                  key={o.value}
                  color="violet"
                  variant="soft"
                  radius="full"
                  // A long value truncates inside the chip rather than widening
                  // the row past the popover's fixed width.
                  style={{ maxWidth: "100%", overflow: "hidden" }}
                  label={
                    <Flex align="center" gap="1" style={{ minWidth: 0 }}>
                      <Text size="sm" truncate>
                        {o.node ?? o.label}
                      </Text>
                      <IconButton
                        size="1"
                        variant="ghost"
                        color="violet"
                        radius="full"
                        aria-label={`Remove ${o.label}`}
                        onClick={() => select(o.value, false)}
                      >
                        <PiX size={12} />
                      </IconButton>
                    </Flex>
                  }
                />
              ))}
            </Flex>
          ) : null}
          <Separator size="4" />
          <Box style={{ maxHeight: 260, overflowY: "auto" }}>
            {filtered.length === 0 ? (
              <Text size="sm" color="text-low">
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
                      tabIndex={o.disabled ? undefined : 0}
                      aria-disabled={o.disabled}
                      onClick={() => select(o.value, !selected, o.disabled)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          select(o.value, !selected, o.disabled);
                        }
                      }}
                      style={{
                        cursor: o.disabled ? "default" : "pointer",
                        opacity: o.disabled ? 0.5 : 1,
                        padding: "6px 8px",
                        borderRadius: "var(--radius-2)",
                        backgroundColor: selected
                          ? "var(--violet-a3)"
                          : undefined,
                      }}
                    >
                      <Text size="sm" truncate>
                        {o.node ?? o.label}
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
                    disabled={o.disabled}
                    value={value.includes(o.value)}
                    setValue={(checked) => select(o.value, checked, o.disabled)}
                    label={o.node ? <>{o.node}</> : o.label}
                  />
                ))}
              </Flex>
            )}
          </Box>
          {value.length > 0 ? (
            <>
              <Separator size="4" />
              <Flex align="center" justify="between">
                {/* Empties the selection but leaves the filter in the bar — the
                    pill's ✕ is what removes it entirely. */}
                <Link size="sm" weight="medium" onClick={() => onChange([])}>
                  Clear
                </Link>
                <Text size="sm" color="text-low">
                  {value.length} selected
                </Text>
              </Flex>
            </>
          ) : null}
        </Flex>
      }
    />
  );
}
