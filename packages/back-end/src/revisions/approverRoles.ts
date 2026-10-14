import { isExpired } from "shared/api-key-expiration";
import type { MemberRoleWithProjects } from "shared/types/organization";
import type { Context } from "back-end/src/models/BaseModel";
import { getOrgApiKey } from "back-end/src/services/organizations";

// Each approver's current role: a member's, or an org key's own. Keys belong
// to no team, so they never satisfy a team rule. A key that is gone, disabled
// or expired covers nothing.
export async function getApproverRoles(
  context: Context,
  approverIds: string[],
): Promise<Map<string, MemberRoleWithProjects | null>> {
  const members = context.org.members ?? [];
  const entries = await Promise.all(
    [...new Set(approverIds)].map(
      async (id): Promise<[string, MemberRoleWithProjects | null]> => {
        const member = members.find((m) => m.id === id);
        if (member) return [id, member];
        const key = await getOrgApiKey(context.org, id);
        if (
          !key?.role ||
          key.userId ||
          key.disabled ||
          isExpired(key.expiresAt)
        ) {
          return [id, null];
        }
        return [
          id,
          {
            role: key.role,
            limitAccessByEnvironment: !!key.limitAccessByEnvironment,
            environments: key.environments ?? [],
            additionalRoles: key.additionalRoles,
            projectRoles: key.projectRoles,
          },
        ];
      },
    ),
  );
  return new Map(entries);
}
