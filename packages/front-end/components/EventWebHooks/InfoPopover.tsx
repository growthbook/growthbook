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
        <button
          type="button"
          aria-label={label}
          style={{
            display: "inline-flex",
            padding: 0,
            border: 0,
            background: "none",
            color: "inherit",
          }}
          // Hover already shows it, so a mouse click would only shut it. A
          // click from the keyboard (no `detail`) is what opens it there.
          onClick={(e) => {
            if (e.detail) e.preventDefault();
          }}
        >
          <PiInfo />
        </button>
      }
      content={
        <Flex direction="column" gap="2">
          {children}
        </Flex>
      }
    />
  );
}
