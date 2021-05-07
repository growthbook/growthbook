import { FC, useContext } from "react";
import useApi from "../../hooks/useApi";
import LoadingOverlay from "../LoadingOverlay";
import Avatar from "../Avatar";
import { date } from "../../services/dates";
import { UserContext } from "../ProtectedPage";
import { useRouter } from "next/router";
import Markdown from "../Markdown/Markdown";

const DiscussionFeed: FC<{
  num?: number;
}> = ({ num = 10 }) => {
  const { data, error } = useApi<{
    discussions: {
      content: string;
      date: Date;
      userId: string;
      userName: string;
      userEmail: string;
      parentType: string;
      parentId: string;
    }[];
  }>(`/discussions/recent/${num}`);

  const router = useRouter();

  const { users } = useContext(UserContext);

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  return (
    <div className="media mb-3">
      <ul className="media-body pl-0">
        {data.discussions.map((comment, i) => {
          const linkUrl =
            "/" + comment.parentType + "/" + comment.parentId + "#discussions";
          const user = users.get(comment.userId);
          const email = user ? user.email : comment.userEmail;
          const name = user ? user.name : comment.userName;

          return (
            <li className="media mb-3" key={i}>
              <Avatar email={email} className="mr-2" />
              <div className="media-body">
                <div
                  className="card cursor-pointer"
                  onClick={(e) => {
                    e.preventDefault();
                    router.push(linkUrl);
                  }}
                >
                  <div className="card-header">
                    <strong>{name || email}</strong> commented on an{" "}
                    {comment.parentType} on {date(comment.date)}
                  </div>
                  <div className="card-body pb-0 pt-3">
                    <Markdown className="card-text">
                      {comment.content || ""}
                    </Markdown>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default DiscussionFeed;
