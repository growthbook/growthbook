import { RESERVED_ROLE_IDS } from "shared/permissions";
import router from "next/router";
import { useState } from "react";
import Link from "next/link";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useAuth } from "@/services/auth";
import Tag from "@/components/Tags/Tag";
import Button from "@/components/Button";

export default function RoleList() {
  const { roles, refreshOrganization } = useUser();
  const [error, setError] = useState<string | null>(null);
  const permissionsUtil = usePermissionsUtil();
  const { apiCall } = useAuth();

  const canManageRoles = permissionsUtil.canManageCustomRoles();

  return (
    <div className="mb-4">
      <div>
        {error ? <div className="alert alert-danger">{error}</div> : null}
        <table className="table appbox gbtable table-hover">
          <thead>
            <tr>
              <th className="col-3">Role</th>
              <th className="col-9">Description</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => {
              const isReservedRole = RESERVED_ROLE_IDS.includes(r.id);
              return (
                <tr key={r.id}>
                  <td>
                    <Link
                      className={`font-weight-bold`}
                      href={`/settings/role/${r.id}`}
                    >
                      {r.id}
                    </Link>{" "}
                    {!isReservedRole ? (
                      <Tag color="#f9f9f9" tag="Custom" />
                    ) : null}
                  </td>
                  <td>{r.description}</td>
                  <td>
                    <MoreMenu>
                      <Button
                        color="btn-link"
                        className="dropdown-item"
                        disabled={!canManageRoles}
                        onClick={async () => {
                          await router.push(`/settings/role/duplicate/${r.id}`);
                        }}
                      >
                        Duplicate
                      </Button>
                      {canManageRoles && !isReservedRole ? (
                        <>
                          <Button
                            color="btn-link"
                            className="dropdown-item"
                            onClick={async () => {
                              await router.push(
                                `/settings/role/${r.id}?edit=true`
                              );
                            }}
                          >
                            Edit
                          </Button>
                          <div className="border-top mt-1 pt-1">
                            <DeleteButton
                              onClick={async () => {
                                setError(null);
                                try {
                                  await apiCall(`/custom-roles/${r.id}`, {
                                    method: "DELETE",
                                  });
                                  refreshOrganization();
                                } catch (e) {
                                  setError(e.message);
                                }
                              }}
                              className="dropdown-item text-danger"
                              displayName="Delete"
                              text="Delete"
                              useIcon={false}
                            />
                          </div>
                        </>
                      ) : null}
                    </MoreMenu>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
