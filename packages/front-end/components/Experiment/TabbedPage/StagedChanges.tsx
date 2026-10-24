import { useEffect, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretUp } from "react-icons/pi";
import LazyDiffViewer from "@/components/AuditHistoryExplorer/LazyDiffViewer";
import { COMPACT_DIFF_STYLES } from "@/components/AuditHistoryExplorer/CompareAuditEventsUtils";
import { stringifyForRawDiff } from "@/components/Reviews/Feature/RevisionDiffUtils";
import Button from "@/ui/Button";
import Collapse, { CollapseTrigger } from "@/ui/Collapse";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import { Popover } from "@/ui/Popover";
import Text from "@/ui/Text";
import { StagedReview, useExperimentEdits } from "./ExperimentEdits";

type SaveCheck = { status: "ready" } | { status: "refused"; reason: string };

function StagedChange({
  label,
  review,
  discard,
}: {
  label: string;
  review: StagedReview | null;
  discard: () => void;
}) {
  const [open, setOpen] = useState(false);
  const before = stringifyForRawDiff(review?.before);
  const after = stringifyForRawDiff(review?.after);
  const hasDiff = before !== after;
  const discardLink = (
    <Link
      size="sm"
      color="gray"
      onClick={(e) => {
        e.preventDefault();
        discard();
      }}
    >
      Discard
    </Link>
  );
  if (!hasDiff) {
    return (
      <Flex align="center" justify="between" gap="4">
        <Text color="text-high">{label}</Text>
        {discardLink}
      </Flex>
    );
  }
  return (
    <Box>
      <CollapseTrigger
        open={open}
        onOpenChange={setOpen}
        caret="start"
        action={discardLink}
      >
        <Text color="text-high">{label}</Text>
      </CollapseTrigger>
      <Collapse open={open}>
        <Box mt="1" style={{ maxHeight: 240, overflowY: "auto" }}>
          <LazyDiffViewer
            oldValue={before}
            newValue={after}
            hideLineNumbers
            extraLinesSurroundingDiff={1}
            styles={COMPACT_DIFF_STYLES}
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

  // The check runs when the list opens or changes, not when the page renders.
  const checkAll = useRef(edits?.checkAll);
  checkAll.current = edits?.checkAll;
  useEffect(() => {
    if (!open || !checkAll.current) return;
    let current = true;
    setCheck(null);
    checkAll
      .current()
      .then(() => {
        if (current) setCheck({ status: "ready" });
      })
      .catch((e) => {
        if (current) {
          setCheck({
            status: "refused",
            reason: e.message || "The save would be refused.",
          });
        }
      });
    return () => {
      current = false;
    };
  }, [open, staged]);

  if (!edits || !staged) return null;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="top"
      align="start"
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
          {staged.map(({ id, label }) => (
            <StagedChange
              key={id}
              label={label}
              review={edits.review(id)}
              discard={() => edits.discard(id)}
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
