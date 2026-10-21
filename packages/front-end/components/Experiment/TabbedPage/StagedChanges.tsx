import { useEffect, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretDown, PiCaretRight, PiCaretUp } from "react-icons/pi";
import LazyDiffViewer from "@/components/AuditHistoryExplorer/LazyDiffViewer";
import { COMPACT_DIFF_STYLES } from "@/components/AuditHistoryExplorer/CompareAuditEventsUtils";
import { stringifyForRawDiff } from "@/components/Reviews/Feature/RevisionDiffUtils";
import Button from "@/ui/Button";
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
  return (
    <Box>
      <Flex align="center" justify="between" gap="4">
        {hasDiff ? (
          <Link color="gray" onClick={() => setOpen(!open)}>
            <Flex align="center" gap="1">
              {open ? <PiCaretDown /> : <PiCaretRight />}
              <Text color="text-high">{label}</Text>
            </Flex>
          </Link>
        ) : (
          <Text color="text-high">{label}</Text>
        )}
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
      </Flex>
      {open && hasDiff ? (
        <Box mt="1" style={{ maxHeight: 240, overflowY: "auto" }}>
          <LazyDiffViewer
            oldValue={before}
            newValue={after}
            hideLineNumbers
            extraLinesSurroundingDiff={1}
            styles={COMPACT_DIFF_STYLES}
          />
        </Box>
      ) : null}
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
  const latestCheck = useRef(0);
  useEffect(() => {
    if (!open || !checkAll.current) return;
    const run = ++latestCheck.current;
    setCheck(null);
    checkAll
      .current()
      .then(() => {
        if (run === latestCheck.current) setCheck({ status: "ready" });
      })
      .catch((e) => {
        if (run === latestCheck.current) {
          setCheck({
            status: "refused",
            reason: e.message || "The save would be refused.",
          });
        }
      });
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
