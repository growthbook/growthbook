import { Box, Flex } from "@radix-ui/themes";
import { UseFormReturn } from "react-hook-form";
import {
  QaOverrideFilterKind,
  QaOverrideFormValues,
} from "@/services/qaOverrides";
import ConditionInput from "@/components/Features/ConditionInput";
import SavedGroupTargetingField from "@/components/Features/SavedGroupTargetingField";
import MultiSelectField from "@/ui/MultiSelectField";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import { QA_OVERRIDE_FILTER_META } from "./useQaOverrideForm";
import styles from "./QaOverrides.module.scss";

type Option = { value: string; label: string };

export default function QaOverrideFilterCard({
  kind,
  form,
  project,
  connectionOptions,
  projectOptions,
  autoFocus,
  onRemove,
}: {
  kind: QaOverrideFilterKind;
  form: UseFormReturn<QaOverrideFormValues>;
  project: string;
  connectionOptions: Option[];
  projectOptions: Option[];
  autoFocus: boolean;
  onRemove: () => void;
}) {
  const values = form.watch();
  const { label } = QA_OVERRIDE_FILTER_META[kind];
  const remove = (
    <Button
      variant="ghost"
      color="gray"
      size="sm"
      aria-label={`Remove ${label} filter`}
      onClick={onRemove}
    >
      Remove
    </Button>
  );
  const multiSelect = (
    field: "sdkConnections" | "projects",
    options: Option[],
    placeholder: string,
  ) => (
    <>
      <Flex align="center" justify="between" mb="1">
        <Text weight="semibold">{label}</Text>
        {remove}
      </Flex>
      <MultiSelectField
        aria-label={label}
        value={values[field]}
        onChange={(v) => form.setValue(field, v)}
        options={options}
        placeholder={placeholder}
        autoFocus={autoFocus}
      />
    </>
  );

  return (
    <Box className={styles.card}>
      {kind === "condition" && (
        <ConditionInput
          label={label}
          labelActions={remove}
          defaultValue={values.condition}
          onChange={(v) => form.setValue("condition", v)}
          project={project}
          emptyText=""
        />
      )}
      {kind === "savedGroups" && (
        <SavedGroupTargetingField
          label={label}
          labelActions={remove}
          value={values.savedGroups}
          setValue={(v) => form.setValue("savedGroups", v)}
          project={project}
        />
      )}
      {kind === "sdkConnections" &&
        multiSelect(
          "sdkConnections",
          connectionOptions,
          "Select SDK connections…",
        )}
      {kind === "projects" &&
        multiSelect("projects", projectOptions, "Select projects…")}
    </Box>
  );
}
