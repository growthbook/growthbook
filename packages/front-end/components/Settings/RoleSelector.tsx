import { MemberRole } from "../../services/auth";
import { FC } from "react";
import clsx from "clsx";

const roles: [MemberRole, string][] = [
  ["collaborator", "Add ideas, comments, insights, and presentations"],
  ["designer", "Create and edit draft experiments"],
  ["developer", "Start and stop experiments and create metrics"],
  ["admin", "Invite team members, add API keys, and configure data sources"],
];

const RoleSelector: FC<{
  role: MemberRole;
  setRole: (role: MemberRole) => void;
}> = ({ role, setRole }) => {
  return (
    <div>
      {roles.map(([name, description]) => (
        <div className="list-group" key={name}>
          <button
            className={clsx("list-group-item list-group-item-action", {
              active: role === name,
              "list-group-item-light": role === name,
            })}
            onClick={(e) => {
              e.preventDefault();
              setRole(name);
            }}
          >
            <div className="d-flex w-100">
              <strong style={{ width: 130 }}>{name}</strong>
              <div style={{ flex: 1 }}>{description}</div>
            </div>
          </button>
        </div>
      ))}
    </div>
  );
};

export default RoleSelector;
