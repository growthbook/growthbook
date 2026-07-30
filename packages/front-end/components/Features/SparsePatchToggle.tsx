import { Flex } from "@radix-ui/themes";
import { PiInfo } from "react-icons/pi";
import Switch from "@/ui/Switch";
import Tooltip from "@/ui/Tooltip";
import Text from "@/ui/Text";

export const SPARSE_PATCH_HELP = (
  <Flex direction="column" gap="2">
    <span>
      Sparse values are merged onto the feature&apos;s default value as
      overrides. Merges top-level keys only.
    </span>
    <span>
      If the default value is not a standard object, the entire sparse value is
      served.
    </span>
  </Flex>
);

// Readonly "Sparse patch (i)" badge — for contexts where sparse is inherited
// from the rule and can't be toggled here (e.g. ramp step editors, fullscreen).
export function SparsePatchIndicator() {
  return (
    <Flex align="center" gap="1">
      <Text size="small" weight="medium" color="text-low">
        Sparse patch
      </Text>
      <Tooltip content={SPARSE_PATCH_HELP}>
        <span style={{ display: "inline-flex", color: "var(--gray-11)" }}>
          <PiInfo size={14} />
        </span>
      </Tooltip>
    </Flex>
  );
}

// JSON-feature-only control that flags a rule value as a sparse patch.
// Presentational only — callers decide when it's eligible (JSON features).
export default function SparsePatchToggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Flex align="center" gap="1">
      <Switch
        value={checked}
        onChange={onChange}
        disabled={disabled}
        label="Sparse patch"
        size="1"
      />
      <Tooltip content={SPARSE_PATCH_HELP}>
        <span style={{ display: "inline-flex", color: "var(--gray-11)" }}>
          <PiInfo size={14} />
        </span>
      </Tooltip>
    </Flex>
  );
}
