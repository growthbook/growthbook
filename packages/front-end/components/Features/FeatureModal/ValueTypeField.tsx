import { FC } from "react";
import { FeatureValueType } from "shared/types/feature";
import { Flex } from "@radix-ui/themes";
import { PiInfo } from "react-icons/pi";
import { useUser } from "@/services/UserContext";
import SelectField, {
  isSingleValue,
  SelectFieldSize,
} from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";

// UI authoring type. "config" is a special, enterprise-gated class of JSON —
// stored as valueType "json" backed by a config, not a runtime value type.
export type FeatureAuthoringType = FeatureValueType | "config";

const BASE_TYPE_LABELS: Record<FeatureValueType, string> = {
  boolean: "Boolean (true/false)",
  string: "String",
  number: "Number",
  json: "JSON",
};

const ValueTypeField: FC<{
  onChange: (v: FeatureAuthoringType) => void;
  value: FeatureAuthoringType;
  // Offer the config-backed authoring type (only flows whose value editor
  // supports config backing should enable this).
  allowConfig?: boolean;
  /** Reorders the base types; config, when offered, stays last. */
  order?: FeatureValueType[];
  /** Defaults to the un-migrated `legacy` the feature modals already use. */
  size?: SelectFieldSize;
  /** Class on the form-group wrapper, e.g. "mb-0" when laid out in a row. */
  containerClassName?: string;
  /** Types that cannot be chosen right now, with the reason shown beside them. */
  disabledOptions?: Partial<Record<FeatureAuthoringType, string>>;
}> = ({
  onChange,
  value,
  allowConfig = false,
  order,
  size = "legacy",
  containerClassName,
  disabledOptions,
}) => {
  const { hasCommercialFeature } = useUser();
  const canUseConfig = hasCommercialFeature("feature-configs");

  return (
    <SelectField
      size={size}
      containerClassName={containerClassName}
      label="Value Type"
      value={value}
      onChange={(v) => onChange(v as FeatureAuthoringType)}
      placeholder="Select Type..."
      options={[
        ...(order ?? ["boolean", "string", "number", "json"]).map((t) => ({
          label: BASE_TYPE_LABELS[t],
          value: t as string,
        })),
        ...(allowConfig ? [{ label: "Config", value: "config" }] : []),
      ]}
      formatOptionLabel={(option) => {
        const blockedReason =
          disabledOptions?.[option.value as FeatureAuthoringType];
        if (blockedReason && option.value !== value) {
          return (
            <span>
              {option.label}{" "}
              <span style={{ color: "var(--slate-9)" }}>({blockedReason})</span>
            </span>
          );
        }
        if (option.value !== "config") return option.label;
        return (
          <Flex as="span" align="center" gap="2" display="inline-flex">
            <span>
              Config{" "}
              <span style={{ color: "var(--slate-9)" }}>(structured JSON)</span>
            </span>
            {canUseConfig ? (
              <Tooltip
                flipTheme={false}
                body="A JSON value backed by a shared Config: the Config supplies the base value and schema, and this Feature Flag overrides it with a patch."
                style={{
                  position: "relative",
                  zIndex: 1000,
                  display: "inline-flex",
                  alignItems: "center",
                }}
              >
                <PiInfo style={{ color: "var(--violet-11)" }} />
              </Tooltip>
            ) : (
              <PaidFeatureBadge commercialFeature="feature-configs" />
            )}
          </Flex>
        );
      }}
      isOptionDisabled={(o) =>
        isSingleValue(o) &&
        ((o.value === "config" && !canUseConfig) ||
          (!!disabledOptions?.[o.value as FeatureAuthoringType] &&
            o.value !== value))
      }
      required
      sort={false}
    />
  );
};

export default ValueTypeField;
