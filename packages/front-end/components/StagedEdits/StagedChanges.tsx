import { ReactNode, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretUp } from "react-icons/pi";
import { canonicalValue } from "shared/util";
import LazyDiffViewer from "@/components/AuditHistoryExplorer/LazyDiffViewer";
import { COMPACT_DIFF_STYLES } from "@/components/AuditHistoryExplorer/CompareAuditEventsUtils";
import { stringifyForRawDiff } from "@/components/Reviews/Feature/RevisionDiffUtils";
import Button from "@/ui/Button";
import Collapse, { CollapseTrigger } from "@/ui/Collapse";
import { RadixStatusIcon } from "@/ui/HelperText";
import Link from "@/ui/Link";
import { Popover } from "@/ui/Popover";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";

export type StagedReview = { before: unknown; after: unknown };

// A save bar's list of staged edits, opened from its count.
export function StagedChangesPopover({
  open,
  onOpenChange,
  count,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  children: ReactNode;
}) {
  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      side="top"
      align="start"
      sideOffset={8}
      contentStyle={{ width: 640, maxWidth: "90vw", padding: "12px 16px" }}
      trigger={
        <Button
          variant="ghost"
          color="gray"
          icon={<PiCaretUp />}
          iconPosition="right"
        >
          {count} staged {count === 1 ? "change" : "changes"}
        </Button>
      }
      content={
        <Flex direction="column" gap="2">
          {children}
        </Flex>
      }
    />
  );
}

// One staged edit: what it changes, and how to drop it.
export function StagedChange({
  label,
  review,
  discard,
  keepMine,
  incompatible,
  saving,
}: {
  label: string;
  review: StagedReview | null;
  discard: () => void;
  // Set while someone else's save conflicts with this edit.
  keepMine: (() => void) | null;
  // Why it can only be discarded, if it can't be saved.
  incompatible: string | null;
  // Mid-save, nothing can be discarded: the save still writes it.
  saving: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Shown as a change is judged, so key order and empty fields aren't diffs.
  const before = stringifyForRawDiff(canonicalValue(review?.before));
  const after = stringifyForRawDiff(canonicalValue(review?.after));
  const hasDiff = before !== after;
  const link = (text: string, onClick: () => void) => (
    <Link
      size="sm"
      color="gray"
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
    >
      {text}
    </Link>
  );
  // Discarding a conflicted edit takes theirs, so it says so.
  const actions = saving ? null : keepMine && !incompatible ? (
    <Flex gap="3">
      {link("Use theirs", discard)}
      {link("Keep mine", keepMine)}
    </Flex>
  ) : (
    link("Discard", discard)
  );
  const title = (
    <Flex align="center" gap="1">
      {incompatible || keepMine ? (
        <Tooltip
          content={
            incompatible ??
            "Someone else saved a change to this since you made yours."
          }
        >
          <Flex as="span" style={{ color: "var(--amber-11)" }}>
            <RadixStatusIcon status="warning" size="sm" />
          </Flex>
        </Tooltip>
      ) : null}
      <Text color="text-high">{label}</Text>
    </Flex>
  );
  if (!hasDiff) {
    return (
      <Flex align="center" justify="between" gap="4">
        {title}
        {actions}
      </Flex>
    );
  }
  return (
    <Box>
      <CollapseTrigger
        open={open}
        onOpenChange={setOpen}
        caret="start"
        action={actions}
      >
        {title}
      </CollapseTrigger>
      <Collapse open={open}>
        <Box mt="1" style={{ maxHeight: 240, overflowY: "auto" }}>
          <LazyDiffViewer
            oldValue={before}
            newValue={after}
            hideLineNumbers
            extraLinesSurroundingDiff={1}
            styles={COMPACT_DIFF_STYLES}
            // Against what's saved now: what Keep mine replaces.
            {...(keepMine && {
              leftTitle: "Modified version",
              rightTitle: "My version",
            })}
          />
        </Box>
      </Collapse>
    </Box>
  );
}
