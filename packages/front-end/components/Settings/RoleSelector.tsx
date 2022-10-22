import { FC } from "react";
import clsx from "clsx";
import { MemberRole } from "back-end/types/organization";
import { useUser } from "../../services/UserContext";

const RoleSelector: FC<{
  role: MemberRole;
  setRole: (role: MemberRole) => void;
}> = ({ role, setRole }) => {
  const { organization } = useUser();

  const roles = organization.roles || [];

  return (
    <div>
      {roles.map(({ description, id }) => (
        <div className="list-group" key={id}>
          <button
            className={clsx("list-group-item list-group-item-action", {
              active: role === id,
            })}
            onClick={(e) => {
              e.preventDefault();
              setRole(id);
            }}
          >
            <div className="d-flex w-100">
              <strong style={{ width: 115 }}>{id}</strong>
              <div style={{ flex: 1 }}>{description}</div>
            </div>
          </button>
        </div>
      ))}
    </div>
  );
};

export default RoleSelector;
