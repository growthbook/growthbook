import { ReactNode } from "react";
import { Box, BoxProps } from "@radix-ui/themes";

// The design's plain grey panel: grey fill, rounded, no border. Used for
// Implementation's full-width container and for Timing and Decision in the
// Analysis Plan.
//
// Not Frame: Frame's border lives in the shared .appbox style and can't be
// turned off, and Frame has no grey fill. @/ui/ has no borderless panel, so
// this is a local gap-filler.
export default function GreyContainer({
  children,
  ...props
}: { children: ReactNode } & BoxProps) {
  return (
    <Box
      p="4"
      style={{
        backgroundColor: "var(--slate-a2)",
        borderRadius: "var(--radius-3)",
      }}
      {...props}
    >
      {children}
    </Box>
  );
}
