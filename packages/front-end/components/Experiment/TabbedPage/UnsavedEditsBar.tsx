import { Box, Flex } from "@radix-ui/themes";
import Button from "@/ui/Button";
import Checkbox from "@/ui/Checkbox";
import HelperText from "@/ui/HelperText";
import { incompatibleNote, useExperimentEdits } from "./ExperimentEdits";
import StagedChanges from "./StagedChanges";
import styles from "./UnsavedEditsBar.module.scss";

/** Appears once something on the page is edited, and is the only way to write it. */
export default function UnsavedEditsBar() {
  const edits = useExperimentEdits();
  if (!edits?.dirty) return null;

  return (
    <div className={styles.bar}>
      <Box
        mx="auto"
        width="100%"
        className="experiment-column"
        style={{ maxWidth: "var(--page-content-max-width)" }}
      >
        <Flex align="center" gap="3">
          <StagedChanges />
          <Box flexGrow="1" />
          {edits.unscopedRule ? (
            <Flex align="center" gap="3">
              <HelperText status="warning" size="sm">
                {edits.unscopedRule.message}
              </HelperText>
              <Box flexShrink="0" style={{ color: "var(--violet-11)" }}>
                <Checkbox
                  value={edits.unscopedRule.acknowledged}
                  setValue={edits.unscopedRule.acknowledge}
                  label="Acknowledge"
                  weight="medium"
                  align="center"
                />
              </Box>
            </Flex>
          ) : null}
          {edits.incompatible.length ? (
            <HelperText status="warning" size="sm">
              {incompatibleNote(edits.incompatible)}
            </HelperText>
          ) : edits.conflicts.length ? (
            <HelperText status="warning" size="sm">
              Someone else saved changes to what you edited. Keep yours or use
              theirs.
            </HelperText>
          ) : null}
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
            Discard changes
          </Button>
          <Button
            disabled={edits.saving || edits.incompatible.length > 0}
            onClick={() => edits.saveAll()}
          >
            {edits.saving ? "Saving..." : "Save"}
          </Button>
        </Flex>
      </Box>
    </div>
  );
}
