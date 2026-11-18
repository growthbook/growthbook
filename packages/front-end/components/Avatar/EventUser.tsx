import { eventUserKeyName, eventUserPerson } from "shared/validators";
import { EventUser as EventUserType } from "shared/types/events/event-types";
import { Flex } from "@radix-ui/themes";
import { PiRobot } from "react-icons/pi";
import Badge from "@/ui/Badge";
import Tooltip from "@/ui/Tooltip";
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
  /** For raw logs: spells out how a key acted and adds its ID to the API tooltip. */
  expanded?: boolean;
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
  expanded = false,
}: Props) {
  const { users, getOwnerDisplay } = useUser();

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
    return expanded ? (
      <Tooltip content="An automatic process or background job not associated with a user">
        <span>System</span>
      </Tooltip>
    ) : (
      <span>System</span>
    );
  }

  // Whoever acted gets the avatar and the name, and the other party goes in the
  // badge. A key acting as itself shows as the key, even when it names who
  // asked; a key that assumed a member's role shows as that member.
  const person = eventUserPerson(user);
  const keyActed = user.type === "api_key" && !person;
  const keyName = eventUserKeyName(user);
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
  } else if (!name && person?.id) {
    // A former member, or a legacy owner stored as a name or email.
    name = getOwnerDisplay(person.id);
  }

  // Treat a blank/whitespace-only name as absent so it never renders as an
  // empty label line or a blank avatar initial (some user records carry " ").
  name = (name || "").trim();
  email = (email || "").trim();

  const avatar = (
    <UserAvatar
      email={email}
      name={name}
      icon={keyActed ? <PiRobot /> : undefined}
      size={size}
      variant="soft"
    />
  );
  if (display === "avatar") return avatar;

  const apiPill = (tip: string) => (
    <Tooltip content={tip}>
      <span>
        <Badge variant="outline" label="API" size="xs" />
      </span>
    </Tooltip>
  );
  // `role` names the key's mode as its settings do, spelled out when expanded.
  const aside = (text: string, tip: string, role: string) => (
    <Tooltip content={tip}>
      <span style={{ color: "var(--color-text-low)" }}>
        {expanded ? `${text} (${role})` : text}
      </span>
    </Tooltip>
  );
  const pillTip =
    keyActed || requester ? "via API key" : "via personal access token";
  // Who else took part, then the API pill on every API request. A nameless key
  // that names no one already reads "API key".
  const attribution =
    user.type === "api_key" ? (
      <>
        {requester &&
          (keyActed
            ? aside(
                `for ${requesterName}`,
                `${requesterName} asked. The key acted with its own permissions.`,
                "used key's role",
              )
            : aside(
                `via ${keyName || "API key"}`,
                "Requested through this API key",
                "assumed member's role",
              ))}
        {(!keyActed || requester || keyName) &&
          apiPill(expanded ? `${pillTip} · ${user.apiKey}` : pillTip)}
      </>
    ) : null;

  const freshUser = { ...user, name, email } as EventUserType;
  // The name, email and attribution read as one phrase, spaced like words.
  const label = (withEmail: boolean) => (
    <Flex
      align="center"
      gap="1"
      wrap={wrap ? "wrap" : "nowrap"}
      display="inline-flex"
    >
      {getUserLabel(freshUser, withEmail)}
      {attribution}
    </Flex>
  );

  if (display === "avatar-name" || display === "avatar-name-email") {
    return (
      <Flex
        align="center"
        gap="2"
        wrap={wrap ? "wrap" : "nowrap"}
        display="inline-flex"
      >
        {avatar}
        {label(display === "avatar-name-email")}
      </Flex>
    );
  }

  return label(display === "name-email");
}
