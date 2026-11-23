import { Box } from "@radix-ui/themes";
import { FeatureInterface } from "shared/types/feature";
import { getFeatureBaseConfigKey } from "shared/util";
import ForceSummary from "@/components/Features/ForceSummary";
import FeatureValueField from "@/components/Features/FeatureValueField";
import HelperText from "@/ui/HelperText";
import EditableValueFrame from "@/components/Features/EditableValueFrame";
import styles from "./FeatureValueCell.module.scss";

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
          compact
          size="md"
          fullWidth
        />
      ) : (
        <EditableValueFrame
          code={showsCode}
          text={showsText}
          tall={tall}
          empty={value === undefined}
          framed={editable}
          edit={
            editable && isJson && onOpenEditor
              ? {
                  label: `Edit ${label} value`,
                  tooltip: "Edit value",
                  onEdit: onOpenEditor,
                }
              : null
          }
        >
          {({ actionsOverlay, extraActions }) =>
            value === undefined ? (
              <HelperText status="warning">No value set</HelperText>
            ) : (
              <ForceSummary
                label={null}
                value={value}
                feature={feature}
                sparse={sparse}
                lineHeight={isJson ? 1.3 : undefined}
                monochrome={!isJson}
                actionsOverlay={actionsOverlay}
                fullWidth
                extraActions={extraActions}
              />
            )
          }
        </EditableValueFrame>
      )}
    </Box>
  );
}
