import { EventUser as EventUserType } from "shared/types/events/event-types";
import Badge from "@/ui/Badge";
import type { Size } from "@/ui/Avatar";
import { useUser } from "@/services/UserContext";
import UserAvatar from "./UserAvatar";

export interface Props {
  user?: EventUserType | null;
  display?: "avatar" | "name" | "avatar-with-email";
  size?: Size;
}

function getUserLabel(user?: EventUserType | null) {
  if (user?.type === "system") {
    return <span>System</span>;
  }
  const name = user && "name" in user ? user.name : "";
  const email = user && "email" in user ? user.email : "";

  if (name && !email) {
    return <span>{name}</span>;
  }
  if (email && !name) {
    return <span>{email}</span>;
  }

  if (name && email) {
    return (
      <>
        <span>{name}</span>
        <span style={{ color: "var(--gray-9)" }}>
          <span style={{ userSelect: "none" }}>&lt;</span>
          {email}
          <span style={{ userSelect: "none" }}>&gt;</span>
        </span>
      </>
    );
  }

  return <span>Unknown</span>;
}

export default function EventUser({
  user,
  display = "avatar",
  size = "md",
}: Props) {
  const { users } = useUser();

  if (user === null || user === undefined) {
    if (display === "avatar") {
      return <UserAvatar size={size} variant="soft" />;
    }
    if (display === "avatar-with-email") {
      return (
        <>
          <UserAvatar size={size} variant="soft" />
          <span>Unknown</span>
        </>
      );
    }
    return <span>Unknown</span>;
  }

  if (user.type === "system") {
    if (display === "avatar") {
      return <UserAvatar name="System" email="" size={size} variant="soft" />;
    }
    if (display === "avatar-with-email") {
      return (
        <>
          <UserAvatar name="System" email="" size={size} variant="soft" />
          <span>System</span>
        </>
      );
    }
    return <span>System</span>;
  }

  // Extract display info from the event user directly
  let name = "name" in user ? user.name : "";
  let email = "email" in user ? user.email : "";
  const isApi = user.type === "api_key";

  // Try to override name/email from latest user context values based on id
  if (user.id) {
    const latestUser = users.get(user.id);
    if (latestUser) {
      name = latestUser.name;
      email = latestUser.email;
    }
  }

  if (display === "avatar") {
    return (
      <UserAvatar
        email={email}
        name={name}
        isApi={isApi}
        size={size}
        variant="soft"
      />
    );
  }

  const apiBadge = isApi ? <Badge variant="soft" label="API" ml="1" /> : null;

  if (display === "avatar-with-email") {
    return (
      <>
        <UserAvatar
          email={email}
          name={name || ""}
          isApi={isApi}
          size={size}
          variant="soft"
        />
        {getUserLabel(user)}
        {apiBadge}
      </>
    );
  }

  return (
    <span>
      {getUserLabel(user)}
      {apiBadge}
    </span>
  );
}
