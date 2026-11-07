import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";

// Marks a Project's setting that differs from the organization default
export function ChangedDot() {
  return (
    <Tooltip content="Changed from the organization default">
      <span
        role="img"
        aria-label="Changed from the organization default"
        style={{
          display: "inline-block",
          flexShrink: 0,
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "var(--violet-9)",
        }}
      />
    </Tooltip>
  );
}

// The organization default's value, next to a Project's changed setting
export function DefaultHint({ value }: { value: string }) {
  return (
    <Text size="sm" color="text-low">
      Default: {value}
    </Text>
  );
}
