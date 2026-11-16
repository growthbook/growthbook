import { useState } from "react";
import { PiCaretRightFill } from "react-icons/pi";
import { Box, Flex } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { EventUser as EventUserType } from "shared/validators";
import Link from "@/ui/Link";
import EventUser from "@/components/Avatar/EventUser";

interface Props extends MarginProps {
  // Co-author IDs (members or API keys), already excluding the primary author.
  coAuthorIds: string[];
  // The stored actor behind each ID; defaults to a member lookup.
  actorFor?: (id: string) => EventUserType;
}

// The collapsible "Co-authors (N)" caret toggle + avatar list, shared by the
// feature and saved-group revision flows. Callers derive `coAuthorIds`
// (however their revision model exposes contributors); this owns only the UI.
export default function CoAuthorsList({
  coAuthorIds,
  actorFor = (id) => ({ type: "dashboard", id, name: "", email: "" }),
  ...marginProps
}: Props) {
  const [open, setOpen] = useState(false);

  if (coAuthorIds.length === 0) return null;

  const label = `Co-author${coAuthorIds.length > 1 ? "s" : ""} (${coAuthorIds.length})`;

  return (
    <Box {...marginProps}>
      <Link
        weight="medium"
        onClick={() => setOpen((o) => !o)}
        style={{ userSelect: "none" }}
      >
        <PiCaretRightFill
          style={{
            display: "inline",
            marginRight: 4,
            transition: "transform 0.15s ease",
            transform: open ? "rotate(90deg)" : "none",
          }}
        />
        {label}
      </Link>
      {open && (
        <Flex direction="column" gap="2" mt="2" ml="3">
          {coAuthorIds.map((id) => (
            <EventUser
              key={id}
              user={actorFor(id)}
              display="avatar-name-email"
              size="sm"
              wrap={true}
            />
          ))}
        </Flex>
      )}
    </Box>
  );
}
