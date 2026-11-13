import { ReactNode } from "react";
import { PiInfo } from "react-icons/pi";
import { Flex } from "@radix-ui/themes";
import { Popover } from "@/ui/Popover";

// An info icon whose popover can hold a link, which a tooltip can't. Each
// child is a paragraph.
export default function InfoPopover({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Popover
      openOnHover
      side="bottom"
      contentStyle={{ maxWidth: 320 }}
      trigger={
        // Flex, so the icon centres on the text beside it rather than sitting
        // on a text line of its own.
        <span
          style={{ display: "inline-flex" }}
          tabIndex={0}
          aria-label={label}
          // In a field's label, a click would focus the field.
          onClick={(e) => e.preventDefault()}
        >
          <PiInfo />
        </span>
      }
      content={
        <Flex direction="column" gap="2">
          {children}
        </Flex>
      }
    />
  );
}
