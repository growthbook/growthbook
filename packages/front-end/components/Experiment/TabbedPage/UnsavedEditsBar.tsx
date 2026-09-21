import { Box, Flex } from "@radix-ui/themes";
import clsx from "clsx";
import Button from "@/ui/Button";
import HelperText from "@/ui/HelperText";
import { useExperimentEdits } from "./ExperimentEdits";
import styles from "./UnsavedEditsBar.module.scss";

/** Appears once something on the page is edited, and is the only way to write it. */
export default function UnsavedEditsBar() {
  const edits = useExperimentEdits();
  if (!edits?.dirty) return null;

  return (
    <div className={clsx(styles.bar, edits.flashing && styles.flashing)}>
      <Box
        mx="auto"
        width="100%"
        style={{ maxWidth: "var(--page-content-max-width)" }}
      >
        <Flex align="center" justify="end" gap="3">
          {edits.error ? (
            <HelperText status="error" size="sm">
              {edits.error}
            </HelperText>
          ) : null}
          <Button
            variant="ghost"
            color="gray"
            disabled={edits.saving}
            onClick={edits.discardAll}
          >
            Discard Changes
          </Button>
          <Button disabled={edits.saving} onClick={() => edits.saveAll()}>
            {edits.saving ? "Saving..." : "Save"}
          </Button>
        </Flex>
      </Box>
    </div>
  );
}
