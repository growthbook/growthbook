import { useEffect, useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiPencilSimpleFill } from "react-icons/pi";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import Markdown from "@/components/Markdown/Markdown";

// Shared "Revision description:" inline block used on the overview surface of
// every revisioned entity (features, saved groups, constants). Label + a
// line-clamped collapsed body with a show more/less toggle, plus an optional
// violet edit pencil.
export default function InlineRevisionDescription({
  comment,
  canEdit,
  onEdit,
  highlightCode = true,
}: {
  comment?: string | null;
  canEdit: boolean;
  onEdit?: () => void;
  highlightCode?: boolean;
}) {
  const [commentExpanded, setCommentExpanded] = useState(false);
  useEffect(() => {
    setCommentExpanded(false);
  }, [comment]);

  const editButton =
    canEdit && onEdit ? (
      <IconButton
        variant="ghost"
        color="violet"
        size="2"
        radius="full"
        onClick={onEdit}
        style={{
          flexShrink: 0,
          marginTop: -2,
          marginBottom: -2,
          marginLeft: 4,
          marginRight: 0,
        }}
      >
        <PiPencilSimpleFill />
      </IconButton>
    ) : null;

  return (
    <Flex align="start" gap="2" style={{ width: "fit-content" }}>
      <Text weight="semibold" color="text-high">
        Revision description:
      </Text>{" "}
      {comment ? (
        <Flex align="start" gap="1">
          <Box>
            <Box
              style={
                !commentExpanded
                  ? {
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }
                  : undefined
              }
            >
              <Markdown className="speech-bubble" highlightCode={highlightCode}>
                {comment}
              </Markdown>
            </Box>
            {comment.length > 80 && (
              <Box mt={commentExpanded ? "1" : "0"}>
                <Link
                  onClick={() => setCommentExpanded((v) => !v)}
                  style={{ whiteSpace: "nowrap" }}
                >
                  {commentExpanded ? "show less" : "show more"}
                </Link>
              </Box>
            )}
          </Box>
          {editButton}
        </Flex>
      ) : (
        <>
          <em style={{ color: "var(--color-text-mid)" }}>none</em>
          {editButton}
        </>
      )}
    </Flex>
  );
}
