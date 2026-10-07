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
      requestedBy: user.requestedBy,
      extendedByRequester: user.extendedByRequester,
    };
  }
  return {
    type: "dashboard",
    id: user.id ?? "",
    email: user.email ?? "",
    name: user.name ?? "",
  };
}
