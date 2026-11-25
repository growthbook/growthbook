import { Box, Flex } from "@radix-ui/themes";
import { Trans, useLingui } from "@lingui/react/macro";
import Checkbox from "@/ui/Checkbox";
import HelperText from "@/ui/HelperText";
import StagedEditsBar from "@/components/StagedEdits/StagedEditsBar";
import { incompatibleNote, useExperimentEdits } from "./ExperimentEdits";
import StagedChanges from "./StagedChanges";

/** Appears once something on the page is edited, and is the only way to write it. */
export default function UnsavedEditsBar() {
  const { t, i18n } = useLingui();
  const edits = useExperimentEdits();
  if (!edits?.dirty) return null;

  return (
    <StagedEditsBar
      changes={<StagedChanges />}
      notes={
        <>
          {edits.unscopedRule ? (
            <Flex align="center" gap="3">
              <HelperText status="warning" size="sm">
                {edits.unscopedRule.message}
              </HelperText>
              <Box flexShrink="0" style={{ color: "var(--violet-11)" }}>
                <Checkbox
                  value={edits.unscopedRule.acknowledged}
                  setValue={edits.unscopedRule.acknowledge}
                  label={t`Acknowledge`}
                  weight="medium"
                  align="center"
                />
              </Box>
            </Flex>
          ) : null}
          {edits.incompatible.length ? (
            <HelperText status="warning" size="sm">
              {incompatibleNote(edits.incompatible, i18n)}
            </HelperText>
          ) : edits.conflicts.length ? (
            <HelperText status="warning" size="sm">
              <Trans>
                Someone else saved changes to what you edited. Keep yours or use
                theirs.
              </Trans>
            </HelperText>
          ) : null}
          {edits.error ? (
            <HelperText status="error" size="sm">
              {edits.error}
            </HelperText>
          ) : null}
        </>
      }
      saving={edits.saving}
      saveDisabled={edits.incompatible.length > 0}
      onDiscard={edits.discardAll}
      onSave={() => edits.saveAll()}
    />
  );
}
