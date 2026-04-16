import { EventUser as EventUserType } from "shared/types/events/event-types";
import { Flex } from "@radix-ui/themes";
import Badge from "@/ui/Badge";
import type { Size } from "@/ui/Avatar";
import { useUser } from "@/services/UserContext";
import UserAvatar from "./UserAvatar";

export interface Props {
  user?: EventUserType | null;
  includeAvatar?: boolean;
  includeName?: boolean;
  includeEmail?: boolean;
  display?:
    | "avatar"
    | "name"
    | "name-email"
    | "avatar-name"
    | "avatar-name-email";
  size?: Size;
  wrap?: boolean;
}

function getUserLabel(user?: EventUserType | null, bothNameAndEmail?: boolean) {
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
        {bothNameAndEmail && (
          <span style={{ color: "var(--gray-9)" }}>
            <span style={{ userSelect: "none" }}>&lt;</span>
            {email}
            <span style={{ userSelect: "none" }}>&gt;</span>
          </span>
        )}
      </>
    );
  }

  return <span>Unknown</span>;
}

export default function EventUser({
  user,
  display = "avatar",
  size = "md",
  wrap = false,
}: Props) {
  const { users } = useUser();

  if (user === null || user === undefined) {
    if (display === "avatar") {
      return <UserAvatar size={size} variant="soft" />;
    }
    if (display === "avatar-name" || display === "avatar-name-email") {
      return (
        <Flex
          align="center"
          gap="2"
          wrap={wrap ? "wrap" : "nowrap"}
          display="inline-flex"
        >
          <UserAvatar size={size} variant="soft" />
          <span>Unknown</span>
        </Flex>
      );
    }
    return <span>Unknown</span>;
  }

  if (user.type === "system") {
    if (display === "avatar") {
      return <UserAvatar name="System" email="" size={size} variant="soft" />;
    }
    if (display === "avatar-name" || display === "avatar-name-email") {
      return (
        <Flex
          align="center"
          gap="2"
          wrap={wrap ? "wrap" : "nowrap"}
          display="inline-flex"
        >
          <UserAvatar name="System" email="" size={size} variant="soft" />
          <span>System</span>
        </Flex>
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

  const apiBadge = isApi ? (
    <Badge
      variant="outline"
      label="API"
      ml="1"
      title="via API Key or Personal Access Token"
    />
  ) : null;

  const freshUser = { ...user, name, email } as EventUserType;

  if (display === "avatar-name" || display === "avatar-name-email") {
    return (
      <Flex
        align="center"
        gap="2"
        wrap={wrap ? "wrap" : "nowrap"}
        display="inline-flex"
      >
        <UserAvatar
          email={email}
          name={name || ""}
          isApi={isApi}
          size={size}
          variant="soft"
        />
        {getUserLabel(freshUser, display === "avatar-name-email")}
        {apiBadge}
      </Flex>
    );
  }

  return (
    <Flex
      align="center"
      gap="2"
      wrap={wrap ? "wrap" : "nowrap"}
      display="inline-flex"
    >
      {getUserLabel(freshUser, display === "name-email")}
      {apiBadge}
    </Flex>
  );
}
