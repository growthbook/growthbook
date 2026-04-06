import { EventUser as EventUserType } from "shared/types/events/event-types";
import Avatar from "./Avatar";

export interface Props {
  user?: EventUserType;
  display?: "avatar" | "name" | "avatar-with-email";
}

export default function EventUser({ user, display = "avatar" }: Props) {
  if (user?.type === "dashboard" && user?.email) {
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
    if (user.email) {
      // Personal access token — show user identity with API badge
      if (display === "avatar-with-email") {
        return (
          <>
            <Avatar
              email={user.email}
              name={user.name || ""}
              size={22}
              showEmail
            />
            <span className="badge badge-secondary ml-1">API</span>
          </>
        );
      }
      return (
        <>
          {display === "avatar" ? (
            <>
              <Avatar email={user.email} name={user.name || ""} size={30} />
              <span className="badge badge-secondary ml-1">API</span>
            </>
          ) : (
            <>
              {user.name || user.email}
              <span className="badge badge-secondary ml-1">API</span>
            </>
          )}
        </>
      );
    }
    return (
      <>
        <span className="badge badge-secondary">API</span>
        {user.name && (
          <span className="ml-1" title={user.apiKey}>
            {user.name}
          </span>
        )}
      </>
    );
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
