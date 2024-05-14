import { Link } from "spectacle";
import { RESERVED_ROLE_IDS } from "shared/permissions";
import router from "next/router";
import { useState } from "react";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useAuth } from "@/services/auth";
import Tag from "@/components/Tags/Tag";
import Button from "@/components/Button";

export default function RoleList() {
  const { roles, refreshOrganization, organization } = useUser();
  const [error, setError] = useState<string | null>(null);
  const permissionsUtil = usePermissionsUtil();
  const { apiCall } = useAuth();

  console.log("organizatin", organization);

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
              //TODO: Build logic to see if any users have this role globally or as a project role
              return (
                <tr key={r.id}>
                  <td>
                    <Link
                      className="font-weight-bold text-decoration-none"
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
                          setError(null);
                          //MKTODO: Add a loading state here somehow
                          try {
                            await apiCall(`/custom-roles`, {
                              method: "POST",
                              body: JSON.stringify({
                                id: `${r.id}_copy`,
                                description: r.description,
                                policies: r.policies,
                              }),
                            });
                            await refreshOrganization();
                            await router.push(`/settings/role/${r.id}_copy`);
                          } catch (e) {
                            setError(e.message);
                          }
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
                              await router.push(`/settings/role/${r.id}`);
                            }}
                          >
                            Edit
                          </Button>
                          <div className="border-top mt-1 pt-1">
                            <DeleteButton
                              //MKTODO: Add validation to prevent deleting role that is applied to users
                              //MKTODO: Add validation to prevent deleting the org's default role
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
                      {/* {isReservedRole ? (
                        <div className="border-top mt-1 pt-1">
                          <Button
                            color="btn-link"
                            className="dropdown-item text-danger"
                            onClick={async () => {
                              try {
                                setError(null);
                                //MKTODO: Build this logic
                                //MKTODO: Add validation to prevent deactivating the org's default role
                                //MKTODO: Add validation to handle reactivating a deactivated role
                              } catch (e) {
                                setError(e.message);
                              }
                            }}
                          >
                            Deactivate
                          </Button>
                        </div>
                      ) : null} */}
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
