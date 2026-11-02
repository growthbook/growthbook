import clsx from "clsx";
import { Box, IconButton } from "@radix-ui/themes";
import { FeatureInterface } from "shared/types/feature";
import { getFeatureBaseConfigKey } from "shared/util";
import ForceSummary from "@/components/Features/ForceSummary";
import FeatureValueField from "@/components/Features/FeatureValueField";
import { ActionsOverlay } from "@/components/Features/CornerActions";
import cornerStyles from "@/components/Features/CornerActions.module.scss";
import HelperText from "@/ui/HelperText";
import Tooltip from "@/ui/Tooltip";
import { EditIcon } from "@/ui/ActionIcons";
import styles from "./FeatureValueCell.module.scss";

// Each button sits 4px inside the cell; the offsets are net of a ghost
// button's negative margin.
const JSON_ACTIONS: ActionsOverlay = {
  revealOnHover: true,
  style: { bottom: 5, right: 10 },
};
const ONE_LINE_ACTIONS: ActionsOverlay = {
  revealOnHover: true,
  style: {
    top: "50%",
    bottom: "auto",
    right: 10,
    transform: "translateY(-50%)",
  },
};
// Centred on the cell, which sits its one line of code 1px high.
const ONE_LINE_JSON_ACTIONS: ActionsOverlay = {
  ...ONE_LINE_ACTIONS,
  style: { ...ONE_LINE_ACTIONS.style, top: "calc(50% + 2px)" },
};

// A non-empty object or array is formatted a key per line, three lines at
// least: room for the edit button at the top, apart from copy and fullscreen
// along the bottom. A config-backed value shows its Config above it, so always.
function spansLines(
  feature: FeatureInterface,
  value: string,
  sparse: boolean,
): boolean {
  if (getFeatureBaseConfigKey(feature) !== null) return true;
  const multiline = (json: string) => {
    try {
      const parsed = JSON.parse(json);
      return (
        typeof parsed === "object" &&
        parsed !== null &&
        Object.keys(parsed).length > 0
      );
    } catch {
      return false;
    }
  };
  // Sparse, it shows merged into the default.
  return multiline(value) || (sparse && multiline(feature.defaultValue));
}

export default function FeatureValueCell({
  id,
  value,
  feature,
  sparse = false,
  editable,
  onChange,
  onOpenEditor,
  label,
}: {
  id: string;
  value: string | undefined;
  feature: FeatureInterface;
  sparse?: boolean;
  editable: boolean;
  onChange: (next: string) => void;
  onOpenEditor?: () => void;
  label: string;
}) {
  const isJson = feature.valueType === "json";
  const showsCode = value !== undefined && isJson;
  const tall = showsCode && spansLines(feature, value, sparse);
  const editButton =
    editable && isJson && onOpenEditor ? (
      <Tooltip content="Edit value">
        <IconButton
          type="button"
          variant="ghost"
          radius="full"
          onClick={onOpenEditor}
          aria-label={`Edit ${label} value`}
        >
          <EditIcon size="sm" />
        </IconButton>
      </Tooltip>
    ) : null;
  const showsText =
    value !== undefined && !isJson && feature.valueType !== "boolean";

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
          fullWidth
        />
      ) : (
        <Box
          className={clsx(
            styles.value,
            showsCode ? styles.code : styles.centered,
            showsText && styles.text,
            editable && styles.frame,
            cornerStyles.hoverActions,
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
              lineHeight={isJson ? 1.3 : undefined}
              monochrome={!isJson}
              actionsOverlay={
                tall
                  ? JSON_ACTIONS
                  : isJson
                    ? ONE_LINE_JSON_ACTIONS
                    : ONE_LINE_ACTIONS
              }
              fullWidth
              extraActions={tall ? null : editButton}
            />
          )}
          {editButton && (tall || value === undefined) ? (
            // With no value, the cell asks for one, so the button always shows.
            <Box
              className={clsx(styles.openEditor, tall && cornerStyles.actions)}
              style={tall ? undefined : ONE_LINE_ACTIONS.style}
            >
              {editButton}
            </Box>
          ) : null}
        </Box>
      )}
    </Box>
  );
}
