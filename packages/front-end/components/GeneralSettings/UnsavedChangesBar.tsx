import { useRouter } from "next/router";
import { Box, Flex } from "@radix-ui/themes";
import Button from "@/ui/Button";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";
import TempMessage from "@/components/TempMessage";
import { describeUnsavedChanges } from "./settingsSections";
import { useSettingsForm } from "./SettingsFormProvider";
import styles from "./SettingsSection.module.scss";

// Floating bar for unsaved General settings. Organization pages save as you
// go, so it only shows on General; the draft is kept for when you return.
export default function UnsavedChangesBar() {
  const router = useRouter();
  const {
    dirtyCount,
    dirtySectionIds,
    saveMsg,
    setSaveMsg,
    submitError,
    setSubmitError,
    save,
    discard,
  } = useSettingsForm();

  if (router.route !== "/settings") return null;
  if (!dirtyCount && !saveMsg && !submitError) return null;

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
          {saveMsg && (
            <TempMessage close={() => setSaveMsg(false)}>
              Settings saved
            </TempMessage>
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
  );
}
