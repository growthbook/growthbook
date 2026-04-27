import type {
  AuditInterface,
  AuditUserApiKey,
  AuditUserLoggedIn,
  AuditUserSystem,
} from "shared/types/audit";
import type { EventUser } from "shared/validators";
import type { AuditUserInfo } from "@/components/AuditHistoryExplorer/types";

export function auditUserInfoToEventUser(user: AuditUserInfo): EventUser {
  if (user.type === "system") {
    return { type: "system" };
  }
  if (user.type === "apikey") {
    return {
      type: "api_key",
      apiKey: user.apiKey ?? "",
      id: user.id,
      name: user.name,
      email: user.email,
    };
  }
  return {
    type: "dashboard",
    id: user.id ?? "",
    email: user.email ?? "",
    name: user.name ?? "",
  };
}

export function auditInterfaceUserToEventUser(
  user: AuditInterface["user"],
): EventUser {
  if ("system" in user && (user as AuditUserSystem).system) {
    return { type: "system" };
  }
  if ("apiKey" in user) {
    const u = user as AuditUserApiKey;
    return {
      type: "api_key",
      apiKey: u.apiKey,
      id: u.id,
      name: u.name,
      email: u.email,
    };
  }
  const u = user as AuditUserLoggedIn;
  return {
    type: "dashboard",
    id: u.id,
    email: u.email,
    name: u.name,
  };
}
