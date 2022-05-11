import { FC } from "react";
import clsx from "clsx";
import { MemberRole } from "back-end/types/organization";

const roles: [MemberRole, string, string][] = [
  ["readonly", "View features and experiment results", ""],
  ["collaborator", "Edit metadata, refresh reports, and add comments", ""],
  [
    "analyst",
    "Create metrics, segments, dimensions, and reports",
    "collaborator",
  ],
  ["developer", "Create and publish features", "analyst"],
  ["admin", "Invite teammates, control organization settings", "developer"],
];

const RoleSelector: FC<{
  role: MemberRole;
  setRole: (role: MemberRole) => void;
}> = ({ role, setRole }) => {
  if (role === "designer") {
    role = "collaborator";
  }

  return (
    <div>
      {roles.map(([name, description, inheritsFrom]) => (
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
              {inheritsFrom && (
                <span className="text-muted mr-2">
                  All {inheritsFrom} permissions +
                </span>
              )}
              <div style={{ flex: 1 }}>{description}</div>
            </div>
          </button>
        </div>
      ))}
    </div>
  );
};

export default RoleSelector;
