import { FC, useState } from "react";
import {
  DiscussionParentType,
  DiscussionInterface,
  Comment,
} from "back-end/types/discussion";
import { FaPencilAlt } from "react-icons/fa";
import { date } from "../services/dates";
import { useAuth } from "../services/auth";
import useApi from "../hooks/useApi";
import { useUser } from "../services/UserContext";
import usePermissions from "../hooks/usePermissions";
import LoadingSpinner from "./LoadingSpinner";
import Avatar from "./Avatar/Avatar";
import DeleteButton from "./DeleteButton/DeleteButton";
import CommentForm from "./CommentForm";
import Markdown from "./Markdown/Markdown";

const DiscussionThread: FC<{
  type: DiscussionParentType;
  id: string;
  allowNewComments?: boolean;
  showTitle?: boolean;
  title?: string;
  project?: string;
}> = ({
  type,
  id,
  allowNewComments = true,
  showTitle = false,
  title = "Add comment",
  project,
}) => {
  const { apiCall } = useAuth();
  const { userId, users } = useUser();
  const [edit, setEdit] = useState(null);

  const permissions = usePermissions();

  if (!permissions.check("addComments", project)) {
    allowNewComments = false;
  }

  const { data, error, mutate } = useApi<{ discussion: DiscussionInterface }>(
    `/discussion/${type}/${id}`
  );

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data) {
    return <LoadingSpinner />;
  }

  const comments: Comment[] = data.discussion ? data.discussion.comments : [];

  return (
    <div className="pagecontents">
      {comments.length > 0 ? (
        <ul className="list-unstyled">
          {comments.map((comment, i) => {
            const user = users.get(comment.userId);
            const email = user ? user.email : comment.userEmail;
            const name = user ? user.name : comment.userName;

            return (
              <li className="media mb-3" key={i}>
                <Avatar email={email} className="mr-2" />
                <div className="media-body">
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
                    <div className="card">
                      <div className="card-header">
                        <strong>{name || email}</strong> commented on{" "}
                        {date(comment.date)}
                        {comment.edited && (
                          <em className="ml-3 text-muted">&bull; edited</em>
                        )}
                        {comment.userId === userId && (
                          <div className="float-right ml-4 card-hover">
                            <a
                              href="#"
                              onClick={(e) => {
                                e.preventDefault();
                                setEdit(i);
                              }}
                            >
                              <FaPencilAlt />
                            </a>
                            <DeleteButton
                              displayName="Comment"
                              className="ml-4"
                              link={true}
                              onClick={async () => {
                                await apiCall(
                                  `/discussion/${type}/${id}/${i}`,
                                  {
                                    method: "DELETE",
                                  }
                                );
                                mutate();
                              }}
                            />
                          </div>
                        )}
                      </div>
                      <div className="card-body">
                        <Markdown className="card-text">
                          {comment.content || ""}
                        </Markdown>
                      </div>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p>
          <em>
            {allowNewComments
              ? "No comments yet. Add the first one!"
              : "No comments."}
          </em>
        </p>
      )}
      {allowNewComments && (
        <>
          {!showTitle && <hr />}
          {showTitle && <h4 className="add-comment-title">{title}</h4>}
          <CommentForm
            cta="Comment"
            onSave={mutate}
            index={-1}
            id={id}
            type={type}
          />
        </>
      )}
    </div>
  );
};

export default DiscussionThread;
