import { FC } from "react";
import { useRouter } from "next/router";
import useApi from "@/hooks/useApi";
import { date } from "@/services/dates";
import { useUser } from "@/services/UserContext";
import LoadingOverlay from "../LoadingOverlay";
import Avatar from "../Avatar/Avatar";
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

  const { users } = useUser();

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  return (
    <div className="">
      <ul className="list-unstyled pl-0 mb-0">
        {data.discussions.map((comment, i) => {
          const linkUrl =
            "/" + comment.parentType + "/" + comment.parentId + "#discussions";
          const user = users.get(comment.userId);
          const email = user ? user.email : comment.userEmail;
          const name = user ? user.name : comment.userName;

          return (
            <li className="mb-3" key={i}>
              <Avatar email={email} className="mr-2 float-left" size={24} />
              <div
                className="card cursor-pointer border-0"
                onClick={(e) => {
                  e.preventDefault();
                  router.push(linkUrl);
                }}
              >
                <div className="">
                  <strong>{name || email}</strong> commented on{" "}
                  {comment.parentType}
                  <div className="text-muted">{date(comment.date)}</div>
                </div>
                <div
                  className="py-1"
                  style={{ maxHeight: 200, overflowY: "auto" }}
                >
                  <Markdown className="speech-bubble d-inline-block">
                    {comment.content || ""}
                  </Markdown>
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
