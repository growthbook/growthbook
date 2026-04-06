import { EventUser as EventUserType } from "shared/types/events/event-types";
import Avatar from "./Avatar";

export interface Props {
  user?: EventUserType;
  display?: "avatar" | "name" | "avatar-with-email";
}

export default function EventUser({ user, display = "avatar" }: Props) {
  // Extract display info from the event user
  let name: string | undefined;
  let email: string | undefined;
  let isApi = false;

  if (user?.type === "dashboard") {
    name = user.name;
    email = user.email;
  } else if (user?.type === "api_key") {
    isApi = true;
    if (user.email) {
      // Personal access token
      name = user.name || "";
      email = user.email;
    } else {
      // Org-wide key — no avatar, just badge + optional description
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
  }

  if (!email) {
    if (display === "name" || display === "avatar-with-email") {
      return (
        <span>
          <em>unknown</em>
        </span>
      );
    }
    return null;
  }

  const apiBadge = isApi ? (
    <span className="badge badge-secondary ml-1">API</span>
  ) : null;

  if (display === "avatar-with-email") {
    return (
      <>
        <Avatar email={email} name={name || ""} size={22} showEmail />
        {apiBadge}
      </>
    );
  }

  if (display === "avatar") {
    return (
      <>
        <Avatar email={email} name={name || ""} size={30} />
        {apiBadge}
      </>
    );
  }

  return (
    <>
      {name || email}
      {apiBadge}
    </>
  );
}
