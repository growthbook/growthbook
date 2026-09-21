import { FC, useState } from "react";
import {
  DiscussionParentType,
  DiscussionInterface,
  Comment,
} from "shared/types/discussion";
import { BsThreeDotsVertical } from "react-icons/bs";
import { datetime } from "shared/dates";
import { Box, Flex, IconButton, Separator } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import LoadingSpinner from "./LoadingSpinner";
import CommentCard from "./Comments/CommentCard";
import CommentForm from "./CommentForm";
import Markdown from "./Markdown/Markdown";

const DiscussionThread: FC<{
  type: DiscussionParentType;
  id: string;
  projects: string[];
  allowNewComments?: boolean;
  showTitle?: boolean;
  title?: string;
  /** Slim chrome for a narrow column: see `CommentCard`. */
  compact?: boolean;
  /**
   * Fill the height given, with the thread scrolling and the composer held at
   * the bottom of the column, clear of the page's save bar.
   */
  fillHeight?: boolean;
}> = ({
  type,
  id,
  allowNewComments = true,
  showTitle = false,
  title = "Add comment",
  projects,
  compact = false,
  fillHeight = false,
}) => {
  const { apiCall } = useAuth();
  const { userId, users } = useUser();
  const [edit, setEdit] = useState<number | null>(null);

  const permissions = usePermissionsUtil();

  if (!permissions.canAddComment(projects)) {
    allowNewComments = false;
  }

  const { data, error, mutate } = useApi<{ discussion: DiscussionInterface }>(
    `/discussion/${type}/${id}`,
  );

  if (error) {
    return <Callout status="error">{error.message}</Callout>;
  }
  if (!data) {
    return <LoadingSpinner />;
  }

  const comments: Comment[] = data.discussion ? data.discussion.comments : [];

  const fill = fillHeight
    ? ({
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
      } as const)
    : undefined;

  return (
    <Box style={fill}>
      {/* The thread takes the height the composer leaves, and scrolls in it. */}
      <Box
        style={
          fillHeight ? { flex: 1, minHeight: 0, overflowY: "auto" } : undefined
        }
      >
        {comments.length > 0 ? (
          <Flex direction="column" gap="4">
            {comments.map((comment, i) => {
              const user = users.get(comment.userId);
              const email = user ? user.email : comment.userEmail;
              const name = user ? user.name : comment.userName;
              const eventUser = {
                type: "dashboard" as const,
                id: comment.userId,
                email: email ?? "",
                name: name ?? "",
              };

              return (
                <Flex key={i} align="start">
                  <Box flexGrow="1">
                    {edit === i ? (
                      <CommentForm
                        cta="Save"
                        onSave={() => {
                          mutate();
                          setEdit(null);
                        }}
                        index={i}
                        id={id}
                        type={type}
                        initialValue={comment.content}
                        autofocus={true}
                        onCancel={() => setEdit(null)}
                      />
                    ) : (
                      <CommentCard
                        compact={compact}
                        user={eventUser}
                        metadata={`commented on ${datetime(comment.date)}`}
                        metadataExtra={
                          comment.edited && (
                            <Text color="text-low" size="sm" fontStyle="italic">
                              &bull; edited
                            </Text>
                          )
                        }
                        actions={
                          comment.userId === userId && (
                            <DropdownMenu
                              trigger={
                                <IconButton
                                  variant="ghost"
                                  color="gray"
                                  radius="full"
                                  size="1"
                                  highContrast
                                  // Ghost buttons carry a negative margin, which
                                  // pulls this one out of the card's corner.
                                  style={{ margin: 0 }}
                                >
                                  <BsThreeDotsVertical size={14} />
                                </IconButton>
                              }
                              variant="soft"
                              menuPlacement="end"
                            >
                              <DropdownMenuItem onClick={() => setEdit(i)}>
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                color="red"
                                confirmation={{
                                  confirmationTitle: "Delete Comment",
                                  cta: "Delete",
                                  submit: async () => {
                                    await apiCall(
                                      `/discussion/${type}/${id}/${i}`,
                                      { method: "DELETE" },
                                    );
                                    mutate();
                                  },
                                }}
                              >
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenu>
                          )
                        }
                        body={
                          <Markdown className="speech-bubble">
                            {comment.content || ""}
                          </Markdown>
                        }
                      />
                    )}
                  </Box>
                </Flex>
              );
            })}
          </Flex>
        ) : (
          <Text
            color="text-low"
            fontStyle="italic"
            size={compact ? "sm" : "md"}
          >
            {allowNewComments
              ? "No comments yet. Add the first one!"
              : "No comments."}
          </Text>
        )}
      </Box>
      {allowNewComments && (
        <Box
          mt="4"
          style={
            fillHeight
              ? {
                  flexShrink: 0,
                  background: "var(--color-panel-solid)",
                  // Clear of the save bar, which publishes its own height.
                  // The help launcher's corner is left to it: the composer's
                  // controls sit on the other side.
                  paddingBottom:
                    "calc(var(--space-3) + var(--experiment-save-bar-height, 0px))",
                }
              : undefined
          }
        >
          {!showTitle ? (
            <Separator size="4" mb="4" />
          ) : (
            <Heading as="h4" size="sm" mb="3">
              {title}
            </Heading>
          )}
          <CommentForm
            cta="Comment"
            onSave={mutate}
            index={-1}
            id={id}
            type={type}
          />
        </Box>
      )}
    </Box>
  );
};

export default DiscussionThread;
