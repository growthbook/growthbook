import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { Popover } from "@/ui/Popover";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";

export type DraftChangeSection = { title: string; render: ReactNode };

// Hovering a draft-changed marker previews what the draft changes, using the
// review tab's formatted renders. Clicks pass through to whatever holds it.
export default function DraftChangesPopover({
  sections,
  children,
}: {
  sections: DraftChangeSection[];
  children: ReactNode;
}) {
  return (
    <Popover
      openOnHover
      anchorOnly
      side="top"
      align="start"
      sideOffset={5}
      trigger={<span>{children}</span>}
      // A set width, so the renders' auto-fill grids lay out side by side.
      contentStyle={{ width: 440, maxWidth: "90vw" }}
      content={
        <Flex direction="column" gap="3">
          <Text weight="medium">This draft changes the live revision:</Text>
          {sections.map((s) => (
            <Box key={s.title}>
              <Heading as="h6" size="sm" color="text-mid" mb="2">
                {s.title}
              </Heading>
              {s.render}
            </Box>
          ))}
        </Flex>
      }
    />
  );
}
