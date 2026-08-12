import { RESERVED_ROLE_IDS, getRoleDisplayName } from "shared/permissions";
import router from "next/router";
import { BsThreeDotsVertical } from "react-icons/bs";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import Link from "@/ui/Link";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useAuth } from "@/services/auth";
import Badge from "@/ui/Badge";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/ui/DropdownMenu";

export default function RoleList() {
  const { roles, refreshOrganization, organization } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const { apiCall } = useAuth();

  const canManageRoles = permissionsUtil.canManageCustomRoles();
  const deactivatedRoles = organization.deactivatedRoles || [];

  return (
    <Box mb="4">
      <Table variant="list" stickyHeader roundedCorners>
        <TableHeader>
          <TableRow>
            <TableColumnHeader>Role</TableColumnHeader>
            <TableColumnHeader>Description</TableColumnHeader>
            <TableColumnHeader style={{ width: 50 }} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {roles.map((r) => {
            const isCustom = !RESERVED_ROLE_IDS.includes(r.id);
            const isOrgDefault =
              organization.settings?.defaultRole?.role === r.id;
            const isDeactivated = deactivatedRoles.includes(r.id);
            return (
              <TableRow key={r.id}>
                <TableCell>
                  <Flex align="center" gap="2">
                    <Link href={`/settings/role/${r.id}`}>
                      {getRoleDisplayName(r.id, organization)}
                    </Link>
                    {isCustom && (
                      <Badge label="Custom" color="violet" variant="soft" />
                    )}
                    {isDeactivated && (
                      <Badge label="Deactivated" color="gray" variant="soft" />
                    )}
                  </Flex>
                </TableCell>
                <TableCell>{r.description}</TableCell>
                <TableCell>
                  <DropdownMenu
                    trigger={
                      <IconButton
                        variant="ghost"
                        color="gray"
                        radius="full"
                        size="2"
                        highContrast
                      >
                        <BsThreeDotsVertical size={18} />
                      </IconButton>
                    }
                    menuPlacement="end"
                    variant="soft"
                  >
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        disabled={!canManageRoles}
                        onClick={async () => {
                          await router.push(`/settings/role/duplicate/${r.id}`);
                        }}
                      >
                        Duplicate
                      </DropdownMenuItem>
                      {canManageRoles && isCustom ? (
                        <>
                          <DropdownMenuItem
                            onClick={async () => {
                              await router.push(
                                `/settings/role/${r.id}?edit=true`,
                              );
                            }}
                          >
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            color="red"
                            confirmation={{
                              submit: async () => {
                                await apiCall(`/custom-roles/${r.id}`, {
                                  method: "DELETE",
                                });
                                refreshOrganization();
                              },
                              confirmationTitle: "Delete Role",
                              cta: "Delete",
                              getConfirmationContent: async () =>
                                "Are you sure you want to delete this role?",
                            }}
                          >
                            Delete
                          </DropdownMenuItem>
                        </>
                      ) : null}
                      <DropdownMenuItem
                        color={!isDeactivated ? "red" : undefined}
                        disabled={!canManageRoles || isOrgDefault}
                        tooltip={
                          isOrgDefault
                            ? "This is your organization's default role and can not be deactivated."
                            : undefined
                        }
                        confirmation={{
                          submit: async () => {
                            await apiCall(
                              `/role/${r.id}/${
                                isDeactivated ? "activate" : "deactivate"
                              }`,
                              { method: "POST" },
                            );
                            refreshOrganization();
                          },
                          confirmationTitle: `${
                            isDeactivated ? "Reactivate" : "Deactivate"
                          } ${r.id}`,
                          cta: isDeactivated ? "Reactivate" : "Deactivate",
                          ctaColor: isDeactivated ? "violet" : "red",
                          getConfirmationContent: async () => (
                            <div>
                              {isDeactivated
                                ? "Reactivating this role will make it selectable as an option when creating new members or updating an existing member's role."
                                : "This role will no longer be listed as an option when creating new members or updating an existing member's role."}
                              {!isDeactivated ? (
                                <div style={{ paddingTop: 8 }}>
                                  Members with this role will not experience any
                                  changes. The role can be reactivated at any
                                  time.
                                </div>
                              ) : null}
                            </div>
                          ),
                        }}
                      >
                        {isDeactivated ? "Reactivate" : "Deactivate"}
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Box>
  );
}
