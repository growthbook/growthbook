import { useState } from "react";
import { PiCaretRightFill } from "react-icons/pi";
import { Box, Flex } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { useUser } from "@/services/UserContext";
import Link from "@/ui/Link";
import EventUser from "@/components/Avatar/EventUser";

interface Props extends MarginProps {
  // Co-author user IDs, already excluding the revision's primary author.
  coAuthorIds: string[];
}

// The collapsible "Co-authors (N)" caret toggle + avatar list, shared by the
// feature and saved-group revision flows. Callers derive `coAuthorIds`
// (however their revision model exposes contributors); this owns only the UI.
export default function CoAuthorsList({ coAuthorIds, ...marginProps }: Props) {
  const [open, setOpen] = useState(false);
  const { users } = useUser();

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
          {coAuthorIds.map((id) => {
            const u = users.get(id);
            return (
              <EventUser
                key={id}
                user={{
                  type: "dashboard",
                  id,
                  name: u?.name || "",
                  email: u?.email || "",
                }}
                display="avatar-name-email"
                size="sm"
                wrap={true}
              />
            );
          })}
        </Flex>
      )}
    </Box>
  );
}
