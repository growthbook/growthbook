import { EventUser as EventUserType } from "shared/types/events/event-types";
import { isNamedUser } from "shared/validators";
import Avatar from "./Avatar";

export interface Props {
  user?: EventUserType;
  display?: "avatar" | "name" | "avatar-with-email";
}

export default function EventUser({ user, display = "avatar" }: Props) {
  if (isNamedUser(user) && user.email) {
    if (display === "avatar-with-email") {
      return <Avatar email={user.email} name={user.name} size={22} showEmail />;
    }
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

  if (display === "name" || display === "avatar-with-email") {
    return (
      <span>
        <em>unknown</em>
      </span>
    );
  }

  return null;
}
