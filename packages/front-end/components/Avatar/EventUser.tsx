import { EventUser as EventUserType } from "back-end/types/events/event-types";
import Avatar from "./Avatar";

export interface Props {
  user?: EventUserType;
  display?: "avatar" | "name";
}

export default function EventUser({ user, display = "avatar" }: Props) {
  if (user?.type === "dashboard" && user?.email) {
    return (
      <>
        {display === "avatar" ? (
          <Avatar email={user.email} name={user.name} size={30} />
        ) : (
          user.name
        )}
      </>
    );
  }

  if (user?.type === "api_key") {
    return <span className="badge badge-secondary">API</span>;
  }

  if (display === "name") {
    return (
      <span>
        <em>unknown</em>
      </span>
    );
  }

  return null;
}
