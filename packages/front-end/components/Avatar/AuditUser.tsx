import { EventAuditUser } from "back-end/src/events/event-types";
import Avatar from "./Avatar";

export interface Props {
  user?: EventAuditUser;
  display?: "avatar" | "name";
}

export default function AuditUser({ user, display = "avatar" }: Props) {
  if (user?.type === "dashboard") {
    return (
      <>
        {display === "avatar" ? (
          <Avatar email={user.email} name={user.name} size={30} />
        ) : (
          user.name
        )}
      </>
    );
  } else if (user?.type === "api_key") {
    return <span className="badge badge-secondary">API</span>;
  }

  return null;
}
