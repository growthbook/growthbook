import { Link } from "spectacle";
import { RESERVED_ROLE_IDS } from "shared/permissions";
import router from "next/router";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useAuth } from "@/services/auth";
import Tag from "@/components/Tags/Tag";
import Button from "@/components/Button";

export default function RoleList() {
  const { roles, refreshOrganization } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const { apiCall } = useAuth();

  const canManageRoles = permissionsUtil.canManageCustomRoles();

  return (
    <div className="mb-4">
      <div>
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
                            //MKTODO: Add error handling
                            console.log("e", e);
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
                            // MKTODO: Add logic to prevent editing a standard role
                            disabled={!canManageRoles}
                            onClick={async () => {
                              await router.push(`/settings/role/${r.id}`);
                            }}
                          >
                            Edit
                          </Button>
                          <DeleteButton
                            //MKTODO: Add validation to prevent deleting role that is applied to users
                            disabled={!canManageRoles || isReservedRole}
                            onClick={async () => {
                              try {
                                await apiCall(`/custom-roles/${r.id}`, {
                                  method: "DELETE",
                                });
                                refreshOrganization();
                              } catch (e) {
                                console.log("e", e);
                              }
                            }}
                            className="dropdown-item text-danger"
                            displayName="Delete"
                            text="Delete Role"
                            useIcon={false}
                          />
                        </>
                      ) : null}
                      {isReservedRole ? (
                        <Button
                          color="btn-link"
                          className="dropdown-item text-danger"
                          onClick={async () => {
                            try {
                              //MKTODO: Build this logic
                              // await apiCall(`/custom-roles`, {
                              //   method: "POST",
                              //   body: JSON.stringify({
                              //     id: `${r.id}_copy`,
                              //     description: r.description,
                              //     policies: r.policies,
                              //   }),
                              // });
                              // refreshOrganization();
                              // // When successful, it needs to route users to the role/id page
                              // await router.push(`/settings/role/${r.id}_copy`);
                            } catch (e) {
                              console.log("e", e);
                            }
                          }}
                        >
                          Deactivate
                        </Button>
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
