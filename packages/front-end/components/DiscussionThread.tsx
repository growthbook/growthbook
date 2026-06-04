import { FC, useState } from "react";
import {
  DiscussionParentType,
  DiscussionInterface,
  Comment,
} from "shared/types/discussion";
import { BsThreeDotsVertical } from "react-icons/bs";
import { date } from "shared/dates";
import { Box, Card, Flex, IconButton, Separator } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import LoadingSpinner from "./LoadingSpinner";
import EventUser from "./Avatar/EventUser";
import CommentForm from "./CommentForm";
import Markdown from "./Markdown/Markdown";

const DiscussionThread: FC<{
  type: DiscussionParentType;
  id: string;
  projects: string[];
  allowNewComments?: boolean;
  showTitle?: boolean;
  title?: string;
}> = ({
  type,
  id,
  allowNewComments = true,
  showTitle = false,
  title = "Add comment",
  projects,
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

  return (
    <Box>
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
                    <Flex align="start" gap="3">
                      <Box flexShrink="0" pt="2">
                        <EventUser
                          user={eventUser}
                          display="avatar"
                          size="sm"
                        />
                      </Box>
                      <Card
                        size="1"
                        style={{ overflow: "hidden", flexGrow: 1 }}
                      >
                        <div
                          style={{
                            position: "absolute",
                            left: 0,
                            top: 0,
                            bottom: 0,
                            width: 4,
                            backgroundColor: "var(--violet-7)",
                          }}
                        />
                        <Box px="1">
                          <Flex justify="between" align="center" mb="2" gap="2">
                            <Flex align="center" gap="2" wrap="wrap">
                              <EventUser
                                user={eventUser}
                                display="name-email"
                                size="sm"
                              />
                              <Text color="text-low" size="small">
                                commented on {date(comment.date)}
                              </Text>
                              {comment.edited && (
                                <Text
                                  color="text-low"
                                  size="small"
                                  fontStyle="italic"
                                >
                                  &bull; edited
                                </Text>
                              )}
                            </Flex>
                            {comment.userId === userId && (
                              <DropdownMenu
                                trigger={
                                  <IconButton
                                    variant="ghost"
                                    color="gray"
                                    radius="full"
                                    size="2"
                                    highContrast
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
                            )}
                          </Flex>
                          <Box pt="1">
                            <Markdown className="speech-bubble">
                              {comment.content || ""}
                            </Markdown>
                          </Box>
                        </Box>
                      </Card>
                    </Flex>
                  )}
                </Box>
              </Flex>
            );
          })}
        </Flex>
      ) : (
        <Text color="text-low" fontStyle="italic">
          {allowNewComments
            ? "No comments yet. Add the first one!"
            : "No comments."}
        </Text>
      )}
      {allowNewComments && (
        <Box mt="4">
          {!showTitle ? (
            <Separator size="4" mb="4" />
          ) : (
            <Heading as="h4" size="small" mb="3">
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
