import { useEffect } from "react";
import { useRouter } from "next/router";
import { Box, Flex } from "@radix-ui/themes";
import { PiCheckBold } from "react-icons/pi";
import Button from "@/ui/Button";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";
import { describeUnsavedChanges } from "./settingsSections";
import { useSettingsForm } from "./SettingsFormProvider";
import styles from "./SettingsSection.module.scss";

const TOAST_MS = 3000;

// Only on General; Organization pages save as you go.
export default function UnsavedChangesBar() {
  const router = useRouter();
  const {
    dirtyCount,
    dirtySectionIds,
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

  if (router.route !== "/settings") return null;

  if (!dirtyCount && savedCount > 0) {
    return (
      <Flex className={styles.savedToastSlot} justify="center">
        <Flex
          className={styles.savedToast}
          align="center"
          gap="3"
          role="status"
        >
          <PiCheckBold className={styles.savedToastIcon} aria-hidden />
          <Text weight="medium">
            Saved {savedCount} change{savedCount === 1 ? "" : "s"}
          </Text>
        </Flex>
      </Flex>
    );
  }

  if (!dirtyCount && !submitError) return null;

  return (
    <Box
      className={styles.unsavedBar}
      role="region"
      aria-label="Unsaved changes"
    >
      <Flex align="center" gap="3" wrap="wrap">
        {dirtyCount > 0 && <span className={styles.unsavedDot} />}
        <Box flexGrow="1" aria-live="polite">
          {dirtyCount > 0 && (
            <Text weight="medium">
              {describeUnsavedChanges(dirtyCount, dirtySectionIds)}
            </Text>
          )}
          {submitError && <HelperText status="error">{submitError}</HelperText>}
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
  );
}
