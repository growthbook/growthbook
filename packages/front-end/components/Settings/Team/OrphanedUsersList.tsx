import React, { FC, useEffect, useState } from "react";
import { BsThreeDotsVertical } from "react-icons/bs";
import { Box, IconButton } from "@radix-ui/themes";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useAuth } from "@/services/auth";
import { isCloud } from "@/services/env";
import Callout from "@/ui/Callout";
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
import AddOrphanedUserModal from "./AddOrphanedUserModal";

const OrphanedUsersList: FC<{
  mutateUsers: () => void;
  numUsersInAccount: number;
  enableAdd?: boolean;
}> = ({ mutateUsers, numUsersInAccount, enableAdd = true }) => {
  const { apiCall } = useAuth();
  const [addModal, setAddModal] = useState<string>("");

  const { data, mutate, error } = useApi<{
    orphanedUsers: { email: string; name: string; id: string }[];
  }>(`/orphaned-users`);

  // Update the list of orphaned users if the number of org members changes
  useEffect(() => {
    mutate();
  }, [numUsersInAccount, mutate]);

  // Only available when self-hosting, since Cloud is a multi-tenant environment
  if (isCloud()) return null;

  if (error) {
    return <Callout status="error">{error.message}</Callout>;
  }

  if (!data) {
    return <LoadingOverlay />;
  }

  const users = data.orphanedUsers;

  if (!users.length) return null;

  const addModalData = addModal && users.find((u) => u.id === addModal);

  return (
    <Box my="4">
      {addModalData && (
        <AddOrphanedUserModal
          close={() => setAddModal("")}
          mutate={() => {
            mutate();
            mutateUsers();
          }}
          {...addModalData}
        />
      )}
      <h5>Orphaned Users{` (${users.length})`}</h5>
      <Table variant="list" stickyHeader roundedCorners>
        <TableHeader>
          <TableRow>
            <TableColumnHeader>Name</TableColumnHeader>
            <TableColumnHeader>Email</TableColumnHeader>
            <TableColumnHeader style={{ width: 50 }} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from(users).map(({ id, email, name }) => {
            return (
              <TableRow key={id}>
                <TableCell>{name}</TableCell>
                <TableCell>{email}</TableCell>
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
                      {enableAdd && (
                        <DropdownMenuItem
                          onClick={() => {
                            setAddModal(id);
                          }}
                        >
                          Add back to account
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        color="red"
                        confirmation={{
                          submit: async () => {
                            await apiCall(`/orphaned-users/${id}/delete`, {
                              method: "POST",
                            });
                            mutate();
                          },
                          confirmationTitle: `Permanently delete ${email}?`,
                          cta: "Permanently delete",
                          getConfirmationContent: async () =>
                            "This action cannot be undone.",
                        }}
                      >
                        Permanently delete
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
};

export default OrphanedUsersList;
