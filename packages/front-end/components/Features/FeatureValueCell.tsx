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
// A one-liner has no corner to spare, so copy sits at its end.
const ONE_LINE_ACTIONS: ActionsOverlay = {
  revealOnHover: true,
  style: {
    top: "50%",
    bottom: "auto",
    right: 2,
    transform: "translateY(-50%)",
  },
};
/**
 * A Feature Flag value that fills a table cell: a field when it can be edited,
 * and framed like one when it can't, so read-only and editable cells line up.
 * JSON is too big to edit in a cell, so it offers a larger editor instead.
 */
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
  // Its type and default are what the value is read against.
  feature: FeatureInterface;
  sparse?: boolean;
  editable: boolean;
  // Outlined as an error, e.g. a value repeated where it shouldn't be.
  error?: boolean;
  onChange: (next: string) => void;
  // Where a JSON value is edited.
  onOpenEditor?: () => void;
  // Names the value for the editor button.
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
          // The same height whatever the type, and as a value shown read-only.
          size="md"
          // Only a string has room for copy, inside its field.
          hideCopyButton={feature.valueType !== "string"}
          outlineStyle={error ? "error" : undefined}
          fullWidth
        />
      ) : (
        <Box
          className={clsx(
            styles.frame,
            cornerStyles.hoverActions,
            (value === undefined || !isJson) && styles.oneLine,
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
              actionsOverlay={isJson ? JSON_ACTIONS : ONE_LINE_ACTIONS}
            />
          )}
          {editable && isJson && onOpenEditor ? (
            <Tooltip content="Edit value">
              <IconButton
                className={clsx(styles.openEditor, cornerStyles.actions)}
                variant="ghost"
                color="violet"
                radius="medium"
                size="1"
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
