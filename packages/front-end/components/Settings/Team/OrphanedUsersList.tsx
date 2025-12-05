import React, { FC, useEffect, useState } from "react";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useAuth } from "@/services/auth";
import { isCloud } from "@/services/env";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
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
    return <div className="alert alert-danger">{error.message}</div>;
  }

  if (!data) {
    return <LoadingOverlay />;
  }

  const users = data.orphanedUsers;

  if (!users.length) return null;

  const addModalData = addModal && users.find((u) => u.id === addModal);

  return (
    <div className="my-4">
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
      <Table variant="standard" className="appbox">
        <TableHeader>
          <TableRow>
            <TableColumnHeader>Name</TableColumnHeader>
            <TableColumnHeader>Email</TableColumnHeader>
            <TableColumnHeader />
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from(users).map(({ id, email, name }) => {
            return (
              <TableRow key={id}>
                <TableCell>{name}</TableCell>
                <TableCell>{email}</TableCell>
                <TableCell style={{ width: 30 }}>
                  {(enableAdd && (
                    <MoreMenu>
                      <button
                        className="dropdown-item"
                        onClick={(e) => {
                          e.preventDefault();
                          setAddModal(id);
                        }}
                      >
                        Add back to account
                      </button>
                      <DeleteButton
                        link={true}
                        text="Permanently delete"
                        useIcon={false}
                        className="dropdown-item"
                        displayName={email}
                        onClick={async () => {
                          await apiCall(`/orphaned-users/${id}/delete`, {
                            method: "POST",
                          });
                          mutate();
                        }}
                      />
                    </MoreMenu>
                  )) || (
                    <DeleteButton
                      link={true}
                      useIcon={true}
                      className="dropdown-item"
                      displayName={email}
                      onClick={async () => {
                        await apiCall(`/orphaned-users/${id}/delete`, {
                          method: "POST",
                        });
                        mutate();
                      }}
                    />
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
};

export default OrphanedUsersList;
