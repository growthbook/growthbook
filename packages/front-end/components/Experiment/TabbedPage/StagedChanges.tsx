import { useEffect, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretUp } from "react-icons/pi";
import { canonicalValue } from "shared/util";
import LazyDiffViewer from "@/components/AuditHistoryExplorer/LazyDiffViewer";
import { COMPACT_DIFF_STYLES } from "@/components/AuditHistoryExplorer/CompareAuditEventsUtils";
import { stringifyForRawDiff } from "@/components/Reviews/Feature/RevisionDiffUtils";
import Button from "@/ui/Button";
import Collapse, { CollapseTrigger } from "@/ui/Collapse";
import HelperText, { RadixStatusIcon } from "@/ui/HelperText";
import Link from "@/ui/Link";
import { Popover } from "@/ui/Popover";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import { ApiCallError } from "@/services/apiCallError";
import {
  incompatibleNote,
  StagedReview,
  useExperimentEdits,
} from "./ExperimentEdits";

type SaveCheck = { status: "ready" } | { status: "refused"; reason: string };

// Why the marked changes can't be saved, in the terms of where they were made.
function StagedChange({
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
  // Made before the experiment's status changed: it can only be discarded.
  incompatible: boolean;
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
            incompatible
              ? "Made before the experiment's status changed."
              : "Someone else saved a change to this since you made yours."
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

/** The save bar's list of staged edits, what each changes, and whether they'd save. */
export default function StagedChanges() {
  const edits = useExperimentEdits();
  const [open, setOpen] = useState(false);
  const [check, setCheck] = useState<SaveCheck | null>(null);
  const staged = edits?.staged;
  const conflicts = edits?.conflicts;
  const incompatible = edits?.incompatible;
  // A save refused over someone else's change, or a status change that left
  // edits behind, opens the list to resolve it.
  useEffect(() => {
    if (conflicts?.length || incompatible?.length) setOpen(true);
  }, [conflicts, incompatible]);

  // The check runs when the list opens or changes, not when the page renders.
  const checkAll = useRef(edits?.checkAll);
  checkAll.current = edits?.checkAll;
  useEffect(() => {
    setCheck(null);
    // Not while edits left behind still block the save.
    if (!open || !checkAll.current || incompatible?.length) return;
    let current = true;
    checkAll
      .current()
      .then(() => {
        // Not while an edit still conflicts.
        if (current && !conflicts?.length) setCheck({ status: "ready" });
      })
      .catch((e) => {
        if (!current) return;
        // Each conflicting edit says so on its own row.
        if (e instanceof ApiCallError && e.code === "changes_conflict") {
          setCheck(null);
          return;
        }
        setCheck({
          status: "refused",
          reason: e.message || "The save would be refused.",
        });
      });
    return () => {
      current = false;
    };
  }, [open, staged, conflicts, incompatible]);

  if (!edits || !staged) return null;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="top"
      align="start"
      sideOffset={8}
      contentStyle={{ width: 640, maxWidth: "90vw", padding: "12px 16px" }}
      trigger={
        <Button
          variant="ghost"
          color="gray"
          size="sm"
          icon={<PiCaretUp />}
          iconPosition="right"
        >
          {staged.length} staged {staged.length === 1 ? "change" : "changes"}
        </Button>
      }
      content={
        <Flex direction="column" gap="2">
          {edits.incompatible.length ? (
            <HelperText status="warning" size="sm" mb="1">
              {incompatibleNote(edits.incompatible)}
            </HelperText>
          ) : null}
          {staged.map(({ id, label }) => (
            <StagedChange
              key={id}
              label={label}
              review={edits.review(id)}
              discard={() => edits.discard(id)}
              keepMine={
                edits.conflicts.includes(id) ? () => edits.keepMine(id) : null
              }
              incompatible={edits.incompatible.some((e) => e.id === id)}
              saving={edits.saving}
            />
          ))}
          {check?.status === "ready" ? (
            <HelperText status="success" size="sm" mt="1">
              Ready to save.
            </HelperText>
          ) : check?.status === "refused" ? (
            <HelperText status="error" size="sm" mt="1">
              {check.reason}
            </HelperText>
          ) : null}
        </Flex>
      }
    />
  );
}
