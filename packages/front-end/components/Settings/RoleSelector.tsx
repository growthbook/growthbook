import { FC } from "react";
import clsx from "clsx";
import { useAdminSettings } from "../../hooks/useAdminSettings";
import LoadingOverlay from "../LoadingOverlay";

const RoleSelector: FC<{
  role: string;
  setRole: (role: string) => void;
}> = ({ role, setRole }) => {
  const { data, error } = useAdminSettings();

  if (error) {
    return <div className="alert alert-danger">An error occurred: {error}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  return (
    <div>
      {Object.entries(data.organization.roles).map(([rId, r]) => (
        <div className="list-group" key={rId}>
          <button
            className={clsx("list-group-item list-group-item-action", {
              active: role === rId,
            })}
            onClick={(e) => {
              e.preventDefault();
              setRole(rId);
            }}
          >
            <div className="d-flex w-100">
              <strong style={{ width: 115, wordBreak: "break-word" }}>
                {rId}
              </strong>
              <div style={{ flex: 1 }}>{r.description}</div>
            </div>
          </button>
        </div>
      ))}
    </div>
  );
};

export default RoleSelector;
