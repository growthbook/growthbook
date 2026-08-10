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
  /**
   * Comment count from a parent-level batch fetch (GET
   * /discussions/counts/:parentType). When provided, this component does not
   * fetch the discussion until expanded — pass it in list views so N cards
   * don't fire N requests just to render counts.
   */
  commentCount?: number;
}> = ({ type, id, projects, commentCount }) => {
  const [expanded, setExpanded] = useState(false);
  // Same SWR key DiscussionThread uses, so once the thread is open the
  // count updates live as comments are added or deleted.
  const { data } = useApi<{ discussion: DiscussionInterface | null }>(
    `/discussion/${type}/${id}`,
    { shouldRun: () => expanded || commentCount === undefined },
  );
  const count = data
    ? (data.discussion?.comments?.length ?? 0)
    : (commentCount ?? 0);

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
