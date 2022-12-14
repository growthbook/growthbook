import { OrganizationInterface } from "back-end/types/organization";

export function getNumberOfUniqueMembersAndInvites(
  organization: Partial<OrganizationInterface>
) {
  const numMembers = new Set(organization.members.map((m) => m.id)).size;
  const numInvites = new Set(organization.invites.map((i) => i.email)).size;

  return numMembers + numInvites;
}
