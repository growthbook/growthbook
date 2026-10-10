import { eventUserPerson } from "shared/validators";
import { EventUser as EventUserType } from "shared/types/events/event-types";
import { Flex } from "@radix-ui/themes";
import { FaRobot } from "react-icons/fa";
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

  return <span>{user?.type === "api_key" ? "API Key" : "Unknown"}</span>;
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

  // Whoever acted gets the avatar and the name, and the other party goes in the
  // badge. A key acting as itself shows as the key, even when it names who
  // asked; a key that assumed a member's role shows as that member.
  const person = eventUserPerson(user);
  const keyActed = user.type === "api_key" && !person;
  const keyName =
    user.type === "api_key" && !user.id ? (user.name || "").trim() : "";
  const requester = user.type === "api_key" ? user.requestedBy : undefined;
  const requesterName = requester
    ? (requester.id && users.get(requester.id)?.name) ||
      requester.name ||
      requester.email
    : "";

  let name = keyActed ? keyName || "API key" : person?.name || "";
  let email = keyActed ? "" : person?.email || "";
  const latestUser = !keyActed && person?.id ? users.get(person.id) : null;
  if (latestUser) {
    name = latestUser.name;
    email = latestUser.email;
  }

  // Treat a blank/whitespace-only name as absent so it never renders as an
  // empty label line or a blank avatar initial (some user records carry " ").
  name = (name || "").trim();
  email = (email || "").trim();

  const avatar = (
    <UserAvatar
      email={email}
      name={name}
      icon={keyActed ? <FaRobot /> : undefined}
      size={size}
      variant="soft"
    />
  );
  if (display === "avatar") return avatar;

  const badge = (label: string, title: string) => (
    <Badge variant="outline" label={label} size="xs" ml="1" title={title} />
  );
  const apiBadge = keyActed
    ? requester
      ? badge(
          `for ${requesterName}`,
          `${requesterName} asked. The key acted with its own permissions.`,
        )
      : keyName
        ? badge("API", "via API key")
        : null
    : user.type === "api_key"
      ? requester
        ? badge(
            `via ${keyName || "API key"}`,
            "Requested through this API key, with only the permissions both the key and this member hold",
          )
        : badge("API", "via personal access token")
      : null;

  const freshUser = { ...user, name, email } as EventUserType;

  if (display === "avatar-name" || display === "avatar-name-email") {
    return (
      <Flex
        align="center"
        gap="2"
        wrap={wrap ? "wrap" : "nowrap"}
        display="inline-flex"
      >
        {avatar}
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
