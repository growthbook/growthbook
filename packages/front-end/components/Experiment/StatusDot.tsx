import { Box } from "@radix-ui/themes";

export default function StatusDot({ color }: { color: string }) {
  return (
    <Box
      style={{
        flexShrink: 0,
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: color,
      }}
    />
  );
}
