import clsx from "clsx";
import { Box, IconButton } from "@radix-ui/themes";
import { PiPencilSimple } from "react-icons/pi";
import { FeatureInterface } from "shared/types/feature";
import ForceSummary from "@/components/Features/ForceSummary";
import FeatureValueField from "@/components/Features/FeatureValueField";
import { ActionsOverlay } from "@/components/Features/CornerActions";
import cornerStyles from "@/components/Features/CornerActions.module.scss";
import HelperText from "@/ui/HelperText";
import Tooltip from "@/ui/Tooltip";
import styles from "./FeatureValueCell.module.scss";

const JSON_ACTIONS: ActionsOverlay = {
  revealOnHover: true,
  style: { bottom: -9, right: 2, gap: "var(--space-2)" },
};
const ONE_LINE_ACTIONS: ActionsOverlay = {
  revealOnHover: true,
  style: {
    top: "50%",
    bottom: "auto",
    right: 2,
    transform: "translateY(-50%)",
  },
};
export default function FeatureValueCell({
  id,
  value,
  feature,
  sparse = false,
  editable,
  error = false,
  onChange,
  onOpenEditor,
  label,
}: {
  id: string;
  value: string | undefined;
  feature: FeatureInterface;
  sparse?: boolean;
  editable: boolean;
  error?: boolean;
  onChange: (next: string) => void;
  onOpenEditor?: () => void;
  label: string;
}) {
  const isJson = feature.valueType === "json";

  return (
    <Box flexGrow="1" minWidth="0" position="relative" className={styles.root}>
      {editable && !isJson ? (
        <FeatureValueField
          id={id}
          value={value ?? ""}
          setValue={onChange}
          valueType={feature.valueType}
          feature={feature}
          useDropdown
          multilineTextField
          size="md"
          hideCopyButton={feature.valueType !== "string"}
          outlineStyle={error ? "error" : undefined}
          fullWidth
        />
      ) : (
        <Box
          className={clsx(
            styles.value,
            (editable || error) && styles.frame,
            cornerStyles.hoverActions,
            error && styles.error,
          )}
        >
          {value === undefined ? (
            <HelperText status="warning">No value set</HelperText>
          ) : (
            <ForceSummary
              label={null}
              value={value}
              feature={feature}
              sparse={sparse}
              fontSize="0.7rem"
              lineHeight={1.3}
              monochrome
              actionsOverlay={isJson ? JSON_ACTIONS : ONE_LINE_ACTIONS}
            />
          )}
          {editable && isJson && onOpenEditor ? (
            <Tooltip content="Edit value">
              <IconButton
                className={clsx(styles.openEditor, cornerStyles.actions)}
                variant="ghost"
                color="violet"
                radius="full"
                size="2"
                onClick={onOpenEditor}
                aria-label={`Edit ${label} value`}
              >
                <PiPencilSimple size="16" />
              </IconButton>
            </Tooltip>
          ) : null}
        </Box>
      )}
    </Box>
  );
}
