import { useEffect, useState } from "react";
import { Box, Flex, VisuallyHidden } from "@radix-ui/themes";
import {
  PiCaretDown,
  PiCaretRight,
  PiCaretUp,
  PiCheckBold,
} from "react-icons/pi";
import LazyDiffViewer from "@/components/AuditHistoryExplorer/LazyDiffViewer";
import { COMPACT_DIFF_STYLES } from "@/components/AuditHistoryExplorer/CompareAuditEventsUtils";
import Button from "@/ui/Button";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import { Popover } from "@/ui/Popover";
import Text from "@/ui/Text";
import { describeUnsavedChanges } from "./settingsSections";
import { SettingsChange, useSettingsForm } from "./SettingsFormProvider";
import styles from "./SettingsSection.module.scss";

const TOAST_MS = 3000;

// Mirrors the experiment page's staged changes list.
function UnsavedChange({ change }: { change: SettingsChange }) {
  const [open, setOpen] = useState(false);
  return (
    <Box>
      <Flex align="center" justify="between" gap="4">
        <Link color="gray" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Flex as="span" align="center" gap="1">
            {open ? <PiCaretDown /> : <PiCaretRight />}
            <Text color="text-high">{change.label}</Text>
          </Flex>
        </Link>
        <Link
          size="sm"
          color="gray"
          aria-label={`Discard ${change.label} changes`}
          onClick={change.discard}
        >
          Discard
        </Link>
      </Flex>
      {open && (
        <Box mt="1" maxHeight="240px" overflowY="auto">
          <LazyDiffViewer
            oldValue={JSON.stringify(change.before, null, 2)}
            newValue={JSON.stringify(change.after, null, 2)}
            hideLineNumbers
            extraLinesSurroundingDiff={1}
            styles={COMPACT_DIFF_STYLES}
          />
        </Box>
      )}
    </Box>
  );
}

// Only on General; Organization pages save as you go.
export default function UnsavedChangesBar() {
  const {
    dirtyCount,
    dirtySectionIds,
    changes,
    savedCount,
    setSavedCount,
    submitError,
    setSubmitError,
    save,
    discard,
  } = useSettingsForm();

  useEffect(() => {
    if (!savedCount) return;
    const timer = setTimeout(() => setSavedCount(0), TOAST_MS);
    return () => clearTimeout(timer);
  }, [savedCount, setSavedCount]);

  const saved = savedCount
    ? `Saved ${savedCount} change${savedCount === 1 ? "" : "s"}`
    : "";

  return (
    <>
      {/* Stays mounted so screen readers announce the text when it changes. */}
      <VisuallyHidden role="status">{saved}</VisuallyHidden>
      {!dirtyCount && saved && (
        <Flex className={styles.savedToastSlot} justify="center" aria-hidden>
          <Flex className={styles.savedToast} align="center" gap="3">
            <PiCheckBold className={styles.savedToastIcon} />
            <Text weight="medium">{saved}</Text>
          </Flex>
        </Flex>
      )}
      {(dirtyCount > 0 || submitError) && (
        <>
          <div className={styles.unsavedBarSpacer} />
          <Box
            className={styles.unsavedBar}
            role="region"
            aria-label="Unsaved changes"
          >
            <Flex align="center" gap="3" wrap="wrap">
              <Box flexGrow="1" aria-live="polite">
                {dirtyCount > 0 && (
                  <Popover
                    side="top"
                    align="start"
                    sideOffset={8}
                    contentStyle={{
                      width: 640,
                      maxWidth: "90vw",
                      // Expanded diffs can outgrow a short window, so the list scrolls.
                      maxHeight:
                        "var(--radix-popover-content-available-height)",
                      overflowY: "auto",
                      padding: "var(--space-3) var(--space-4)",
                    }}
                    trigger={
                      <Button
                        variant="ghost"
                        color="gray"
                        icon={<PiCaretUp />}
                        iconPosition="right"
                      >
                        {describeUnsavedChanges(dirtyCount, dirtySectionIds)}
                      </Button>
                    }
                    content={
                      <Flex direction="column" gap="2">
                        {changes.map((c) => (
                          <UnsavedChange key={c.id} change={c} />
                        ))}
                      </Flex>
                    }
                  />
                )}
                {submitError && (
                  <HelperText status="error">{submitError}</HelperText>
                )}
              </Box>
              {dirtyCount > 0 && (
                <>
                  <Button variant="ghost" onClick={discard}>
                    Discard
                  </Button>
                  <Button onClick={save} setError={setSubmitError}>
                    Save changes
                  </Button>
                </>
              )}
            </Flex>
          </Box>
        </>
      )}
    </>
  );
}
