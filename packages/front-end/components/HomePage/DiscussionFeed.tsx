import { FC } from "react";
import { useRouter } from "next/router";
import { date } from "shared/dates";
import useApi from "@/hooks/useApi";
import { useUser } from "@/services/UserContext";
import LoadingOverlay from "@/components/LoadingOverlay";
import EventUser from "@/components/Avatar/EventUser";
import Markdown from "@/components/Markdown/Markdown";

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
          const eventUser = {
            type: "dashboard" as const,
            id: comment.userId,
            email: email ?? "",
            name: name ?? "",
          };

          return (
            <li className="mb-3" key={i}>
              <div className="mr-2 float-left">
                <EventUser user={eventUser} display="avatar" size="sm" />
              </div>
              <div
                className="card cursor-pointer border-0"
                onClick={(e) => {
                  e.preventDefault();
                  router.push(linkUrl);
                }}
              >
                <div className="">
                  <strong>
                    <EventUser user={eventUser} display="name" />
                  </strong>{" "}
                  commented on {comment.parentType}
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
