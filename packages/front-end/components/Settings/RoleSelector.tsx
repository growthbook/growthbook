import { FC } from "react";
import clsx from "clsx";
import { MemberRole } from "back-end/types/organization";

const roles: [MemberRole, string][] = [
  ["readonly", "View all features and experiment results"],
  ["collaborator", "Add comments and contribute ideas"],
  ["engineer", "Manage features"],
  ["analyst", "Analyze experiments"],
  ["experimenter", "Manage features AND analyze experiments"],
  [
    "admin",
    "All access + invite teammates and configure organization settings",
  ],
];

const RoleSelector: FC<{
  role: MemberRole;
  setRole: (role: MemberRole) => void;
  onSubmitChangeRole?: () => void;
}> = ({ role, setRole, onSubmitChangeRole }) => {
  return (
    <div>
      {roles.map(([name, description]) => (
        <div className="list-group" key={name}>
          <button
            className={clsx("list-group-item list-group-item-action", {
              active: role === name,
            })}
            onClick={(e) => {
              e.preventDefault();
              setRole(name);
            }}
          >
            <div className="d-flex w-100">
              <strong style={{ width: 115 }}>{name}</strong>
              <div style={{ flex: 1 }}>{description}</div>
            </div>
          </button>
        </div>
      ))}
      {onSubmitChangeRole && (
        <button className="btn btn-primary mt-3" onClick={onSubmitChangeRole}>
          Update Role
        </button>
      )}
    </div>
  );
};

export default RoleSelector;
