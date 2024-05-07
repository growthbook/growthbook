import { OrganizationInterface } from "back-end/types/organization";

export function getNumberOfUniqueMembersAndInvites(
  organization: Partial<OrganizationInterface>,
) {
  // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
  const numMembers = new Set(organization.members.map((m) => m.id)).size;
  // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
  const numInvites = new Set(organization.invites.map((i) => i.email)).size;

  return numMembers + numInvites;
}
