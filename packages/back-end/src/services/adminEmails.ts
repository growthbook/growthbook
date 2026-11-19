import { getUsersByIds } from "back-end/src/models/UserModel";
import { ReqContext } from "back-end/types/request";

export async function getAdminEmails(context: ReqContext): Promise<string[]> {
  const adminIds = context.org.members
    .filter((m) => m.role === "admin")
    .map((m) => m.id);
  const admins = adminIds.length ? await getUsersByIds(adminIds) : [];
  return [
    ...new Set(
      [context.org.ownerEmail, ...admins.map((u) => u.email)].filter(Boolean),
    ),
  ];
}
