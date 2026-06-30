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
                    <CommentCard
                      user={eventUser}
                      metadata={`commented on ${datetime(comment.date)}`}
                      metadataExtra={
                        comment.edited && (
                          <Text
                            color="text-low"
                            size="small"
                            fontStyle="italic"
                          >
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
