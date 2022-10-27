import { MemberRole } from "back-end/types/organization";
import { ReactElement } from "react";

export default function RoleDisplay({
  role,
}: {
  role: MemberRole;
}): ReactElement {
  return <span className="badge badge-secondary">{role}</span>;
}
