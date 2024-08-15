import { RESERVED_ROLE_IDS } from "shared/permissions";
import router from "next/router";
import Link from "next/link";
import DeleteButton from "@front-end/components/DeleteButton/DeleteButton";
import MoreMenu from "@front-end/components/Dropdown/MoreMenu";
import { useUser } from "@front-end/services/UserContext";
import usePermissionsUtil from "@front-end/hooks/usePermissionsUtils";
import { useAuth } from "@front-end/services/auth";
import Tag from "@front-end/components/Tags/Tag";
import Button from "@front-end/components/Button";
import ConfirmButton from "@front-end/components/Modal/ConfirmButton";
import Tooltip from "@front-end/components/Tooltip/Tooltip";

export default function RoleList() {
  const { roles, refreshOrganization, organization } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const { apiCall } = useAuth();

  const canManageRoles = permissionsUtil.canManageCustomRoles();
  const deactivatedRoles = organization.deactivatedRoles || [];

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
              const isOrgDefault =
                organization.settings?.defaultRole?.role === r.id;
              const isDeactivated = deactivatedRoles.includes(r.id);
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
                    {isDeactivated ? (
                      <Tag color="#808080" tag="Deactivated" />
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
                      <ConfirmButton
                        modalHeader={`${
                          isDeactivated ? "Reactivate" : "Deactivate"
                        } ${r.id}`}
                        disabled={!canManageRoles || isOrgDefault}
                        ctaColor="danger"
                        confirmationText={
                          <div>
                            {isDeactivated
                              ? "Reactivating this role will make it selectable as an option when creating new members or updating an existing member's role."
                              : "This role will no longer be listed as an option when creating new members or updating an existing member's role."}
                            {!isDeactivated ? (
                              <div className="pt-2">
                                Members with this role will not experience any
                                changes. The role can be reactivated at any
                                time.
                              </div>
                            ) : null}
                          </div>
                        }
                        onClick={async () => {
                          await apiCall(
                            `/role/${r.id}/${
                              isDeactivated ? "activate" : "deactivate"
                            }`,
                            {
                              method: "POST",
                            }
                          );
                          refreshOrganization();
                        }}
                        cta={isDeactivated ? "Reactivate" : "Deactivate"}
                      >
                        <Tooltip
                          body="This is your organization's default role and can not be deactivated."
                          shouldDisplay={isOrgDefault}
                          tipPosition="left"
                        >
                          <button
                            disabled={isOrgDefault}
                            className={`dropdown-item ${
                              !isDeactivated ? "text-danger" : ""
                            }`}
                            type="button"
                          >
                            {isDeactivated ? "Reactivate" : "Deactivate"}
                          </button>
                        </Tooltip>
                      </ConfirmButton>
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
