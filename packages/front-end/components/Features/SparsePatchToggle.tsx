import { Flex } from "@radix-ui/themes";
import { PiInfo } from "react-icons/pi";
import Switch from "@/ui/Switch";
import Tooltip from "@/ui/Tooltip";

export const SPARSE_PATCH_HELP =
  "Treat the value as a partial object. Only the keys you include override the feature's default value; every other key falls back to the default.";

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
