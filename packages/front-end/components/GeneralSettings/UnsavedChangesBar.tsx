import { useEffect, useState } from "react";
import { Flex, VisuallyHidden } from "@radix-ui/themes";
import { PiCheckBold } from "react-icons/pi";
import StagedEditsBar from "@/components/StagedEdits/StagedEditsBar";
import {
  StagedChange,
  StagedChangesPopover,
} from "@/components/StagedEdits/StagedChanges";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";
import { useSettingsForm } from "./SettingsFormProvider";
import styles from "./SettingsSection.module.scss";

const TOAST_MS = 3000;

// Only on General; Organization pages save as you go.
export default function UnsavedChangesBar() {
  const {
    dirtyCount,
    changes,
    savedCount,
    setSavedCount,
    submitError,
    setSubmitError,
    save,
    discard,
  } = useSettingsForm();
  const [saving, setSaving] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);

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
      {dirtyCount > 0 && (
        <StagedEditsBar
          pinned
          changes={
            <StagedChangesPopover
              open={changesOpen}
              onOpenChange={setChangesOpen}
              count={dirtyCount}
            >
              {changes.map((c) => (
                <StagedChange
                  key={c.id}
                  label={c.label}
                  review={c}
                  discard={c.discard}
                  keepMine={null}
                  incompatible={null}
                  saving={saving}
                />
              ))}
            </StagedChangesPopover>
          }
          notes={
            submitError && <HelperText status="error">{submitError}</HelperText>
          }
          saving={saving}
          onDiscard={discard}
          onSave={async () => {
            setSaving(true);
            try {
              await save();
            } catch (e) {
              setSubmitError(
                e instanceof Error ? e.message : "The settings weren't saved.",
              );
            } finally {
              setSaving(false);
            }
          }}
        />
      )}
    </>
  );
}
