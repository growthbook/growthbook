import { Flex } from "@radix-ui/themes";
import { PiInfo } from "react-icons/pi";
import Switch from "@/ui/Switch";
import Tooltip from "@/ui/Tooltip";
import Text from "@/ui/Text";

export const SPARSE_PATCH_HELP =
  "Treat the value as a partial object. Only the top-level keys you include override the feature's default value; every other key falls back to the default. Merging is top-level only — a nested object you include replaces the default's value for that key entirely (it is not deep-merged).";

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

// JSON-feature-only control that flags a rule value as a sparse patch. Presentational
// only — callers decide when it's eligible (JSON feature with a plain-object default).
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
