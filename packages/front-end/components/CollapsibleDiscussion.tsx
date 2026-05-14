import { FC, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretDown, PiCaretRight, PiChatCircle } from "react-icons/pi";
import {
  DiscussionInterface,
  DiscussionParentType,
} from "shared/types/discussion";
import Button from "@/ui/Button";
import useApi from "@/hooks/useApi";
import DiscussionThread from "./DiscussionThread";

const CollapsibleDiscussion: FC<{
  type: DiscussionParentType;
  id: string;
  projects: string[];
}> = ({ type, id, projects }) => {
  const [expanded, setExpanded] = useState(false);
  const { data } = useApi<{ discussion: DiscussionInterface | null }>(
    `/discussion/${type}/${id}`,
  );
  const count = data?.discussion?.comments?.length ?? 0;

  return (
    <Box>
      <Box mb={expanded ? "3" : "0"}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded((v) => !v)}
        >
          <Flex align="center" gap="2">
            {expanded ? <PiCaretDown /> : <PiCaretRight />}
            <PiChatCircle />
            <span>
              {count} {count === 1 ? "comment" : "comments"}
            </span>
          </Flex>
        </Button>
      </Box>
      {expanded && (
        <Box pl="3">
          <DiscussionThread type={type} id={id} projects={projects} />
        </Box>
      )}
    </Box>
  );
};

export default CollapsibleDiscussion;
