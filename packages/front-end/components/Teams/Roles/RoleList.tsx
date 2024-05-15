import { RESERVED_ROLE_IDS } from "shared/permissions";
import router from "next/router";
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
              const isCustom = !RESERVED_ROLE_IDS.includes(r.id);
              return (
                <tr key={r.id}>
                  <td>
                    <Link
                      className={`font-weight-bold`}
                      href={`/settings/role/${r.id}`}
                    >
                      {r.id}
                    </Link>{" "}
                    {isCustom ? <Tag color="#f9f9f9" tag="Custom" /> : null}
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
                      {canManageRoles && isCustom ? (
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
                                await apiCall(`/custom-roles/${r.id}`, {
                                  method: "DELETE",
                                });
                                refreshOrganization();
                              }}
                              className="dropdown-item text-danger"
                              displayName="Delete"
                              text="Delete"
                              useIcon={false}
                              deleteMessage="Are you you want to delete this role?"
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
