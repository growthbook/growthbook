import { ReactNode, useEffect, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretDownBold } from "react-icons/pi";
import RevisionLabel, {
  revisionLabelText,
} from "@/components/Reviews/RevisionLabel";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/ui/DropdownMenu";
import Link from "@/ui/Link";
import Text from "@/ui/Text";

// A normalized row for the shared revision dropdown. Entity wrappers map their
// own revision shape (the feature MinimalFeatureRevisionInterface, the generic
// Revision) into this — the dropdown itself stays entity-agnostic.
export interface RevisionDropdownRow {
  // Opaque selection key (feature: the version as a string; saved groups: the
  // revision id). Passed back verbatim to onSelect.
  key: string;
  version: number;
  title?: string;
  // Attribution/date line — wrapper-built so each entity keeps its own
  // rendering (EventUser vs getUserDisplay, "Published: …" vs author · date).
  meta?: ReactNode;
  // Status badge — wrapper-built so each entity keeps its own badge component.
  badge?: ReactNode;
}

function RevisionRow({ row }: { row: RevisionDropdownRow }) {
  return (
    <Flex align="center" justify="between" gap="3" style={{ width: "100%" }}>
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Text weight="semibold">
          <span
            style={{
              display: "block",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: 400,
            }}
            title={revisionLabelText(row.version, row.title)}
          >
            <RevisionLabel version={row.version} title={row.title} />
          </span>
        </Text>
      </Box>
      {row.meta && (
        <Box
          flexShrink="1"
          overflow="hidden"
          style={{ textOverflow: "ellipsis" }}
        >
          {row.meta}
        </Box>
      )}
      {row.badge && (
        <Flex flexShrink="0" align="center" gap="2">
          {row.badge}
        </Flex>
      )}
    </Flex>
  );
}

// Shared revision version-picker dropdown. Owns the open state, scroll-into-
// view, pagination ("Show all"), the trigger shell, and menu rendering. Entity-
// specific concerns — filtering, attribution/date metadata, the status badge,
// and the live/selected logic — are supplied by the wrapper via `rows` (already
// filtered + sorted, newest first), `selectedBadge`, and the `toggles` slot.
export default function RevisionDropdown({
  rows,
  selectedKey,
  onSelect,
  toggles,
  selectedBadge,
  triggerPlaceholder,
  triggerNumbered,
  context,
  menuPlacement = "end",
  paginate = true,
  windowFromSelection = true,
  initialPageSize = 5,
}: {
  rows: RevisionDropdownRow[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  // Filter switches rendered above the items (wrapper-built, each wrapped in a
  // DropdownMenuLabel).
  toggles?: ReactNode;
  // The status badge for the trigger (wrapper-built from the selected row).
  selectedBadge?: ReactNode;
  // Shown in the trigger when nothing is selected.
  triggerPlaceholder?: string;
  // Overrides RevisionLabel's `numbered` in the trigger; defaults to whether the
  // selected row has a title.
  triggerNumbered?: boolean;
  context?: "header";
  menuPlacement?: "start" | "center" | "end";
  // When false, all rows render with no "Show all" paging (the feature
  // drafts-only mode).
  paginate?: boolean;
  // When false, the initial window is just `initialPageSize` regardless of where
  // the selected row sits (the feature published-only / drafts-only modes).
  windowFromSelection?: boolean;
  initialPageSize?: number;
}) {
  const [open, setOpen] = useState(false);
  const [extraShown, setExtraShown] = useState(0);

  useEffect(() => {
    if (open) {
      const frame = requestAnimationFrame(() => {
        document
          .querySelector(".rt-DropdownMenuContent .selected-item")
          ?.scrollIntoView({ block: "nearest" });
      });
      return () => cancelAnimationFrame(frame);
    } else {
      setExtraShown(0);
    }
  }, [open]);

  const selectedIndex =
    selectedKey === null ? -1 : rows.findIndex((r) => r.key === selectedKey);
  const baseWindow = !paginate
    ? rows.length
    : windowFromSelection
      ? Math.max(initialPageSize, selectedIndex >= 0 ? selectedIndex + 1 : 0)
      : initialPageSize;
  const windowSize = baseWindow + extraShown;
  const shown = rows.slice(0, windowSize);
  const remaining = rows.length - windowSize;

  const selectedRow =
    selectedKey !== null ? rows.find((r) => r.key === selectedKey) : undefined;

  const handleSelect = (key: string) => {
    onSelect(key);
    setOpen(false);
  };

  const triggerWidth = context === "header" ? 280 : "100%";

  const trigger = (
    <Flex
      align="center"
      justify="between"
      gap="3"
      style={{ width: triggerWidth, overflow: "hidden" }}
    >
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Text weight="semibold">
          {selectedRow ? (
            <span
              style={{
                display: "block",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: 400,
              }}
              title={revisionLabelText(selectedRow.version, selectedRow.title)}
            >
              <RevisionLabel
                numbered={triggerNumbered ?? !!selectedRow.title}
                version={selectedRow.version}
                title={selectedRow.title}
              />
            </span>
          ) : (
            (triggerPlaceholder ?? null)
          )}
        </Text>
      </Box>
      {selectedBadge && (
        <Flex flexShrink="0" align="center" gap="2">
          {selectedBadge}
        </Flex>
      )}
      <PiCaretDownBold style={{ flexShrink: 0 }} />
    </Flex>
  );

  return (
    <DropdownMenu
      variant="soft"
      open={open}
      onOpenChange={setOpen}
      trigger={trigger}
      triggerClassName={`dropdown-trigger-select-style${context === "header" ? " dropdown-trigger-header" : ""}`}
      triggerStyle={
        context === "header" ? { paddingTop: 4, paddingBottom: 4 } : undefined
      }
      menuWidth="full"
      menuPlacement={menuPlacement}
    >
      {toggles}
      {shown.map((row) => (
        <DropdownMenuItem
          key={row.key}
          className={`multiline-item${
            row.key === selectedKey ? " selected-item" : ""
          }`}
          onClick={() => handleSelect(row.key)}
        >
          <RevisionRow row={row} />
        </DropdownMenuItem>
      ))}
      {remaining > 0 && (
        <DropdownMenuLabel>
          <Link
            size="2"
            onClick={() => setExtraShown((prev) => prev + remaining)}
          >
            Show all ({remaining} more)
          </Link>
        </DropdownMenuLabel>
      )}
    </DropdownMenu>
  );
}
