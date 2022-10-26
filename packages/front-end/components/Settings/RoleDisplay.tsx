import { MemberRole } from "back-end/types/organization";
import { ReactElement } from "react";
import { isLight } from "../Tags/Tag";

const colorMap: Record<MemberRole, string> = {
  admin: "#D64538",
  analyst: "#0047bd",
  collaborator: "#e2d221",
  designer: "#e2d221",
  developer: "#20C9B9",
  engineer: "#fc8414",
  experimenter: "#28A66B",
  readonly: "#CCCCCC",
};

export default function RoleDisplay({
  role,
}: {
  role: MemberRole;
}): ReactElement {
  return (
    <span
      className="badge"
      style={{
        backgroundColor: colorMap[role],
        color: isLight(colorMap[role]) ? "#000000" : "#ffffff",
      }}
    >
      {role}
    </span>
  );
}
