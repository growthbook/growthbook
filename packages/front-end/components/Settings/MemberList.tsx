import React, { FC, useState } from "react";
import InviteModal from "./InviteModal";
import { useAuth } from "../../services/auth";
import { useUser } from "../../services/UserContext";
import DeleteButton from "../DeleteButton";
import { GBAddCircle } from "../Icons";
import { ExpandedMember } from "back-end/types/organization";
import MoreMenu from "../Dropdown/MoreMenu";
import { usingSSO } from "../../services/env";
import AdminSetPasswordModal from "./AdminSetPasswordModal";
import ChangeRoleModal from "./ChangeRoleModal";
import RoleDisplay from "./RoleDisplay";

const MemberList: FC<{
  mutate: () => void;
}> = ({ mutate }) => {
  const [inviting, setInviting] = useState(false);
  const { apiCall } = useAuth();
  const { userId, users } = useUser();
  const [roleModal, setRoleModal] = useState<string>("");
  const [passwordResetModal, setPasswordResetModal] = useState<ExpandedMember>(
    null
  );

  const onInvite = () => {
    setInviting(true);
  };

  const roleModalUser = users.get(roleModal);

  return (
    <div className="my-4">
      <h5>Active Members</h5>
      {inviting && (
        <InviteModal close={() => setInviting(false)} mutate={mutate} />
      )}
      {roleModal && roleModalUser && (
        <ChangeRoleModal
          displayInfo={roleModalUser.name}
          roleInfo={{
            environments: roleModalUser.environments || [],
            limitAccessByEnvironment: !!roleModalUser.limitAccessByEnvironment,
            role: roleModalUser.role,
          }}
          close={() => setRoleModal(null)}
          onConfirm={async (value) => {
            await apiCall(`/member/${roleModal}/role`, {
              method: "PUT",
              body: JSON.stringify(value),
            });
            mutate();
          }}
        />
      )}
      {passwordResetModal && (
        <AdminSetPasswordModal
          close={() => setPasswordResetModal(null)}
          member={passwordResetModal}
        />
      )}
      <table className="table appbox gbtable">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {Array.from(users).map(([id, member]) => (
            <tr key={id}>
              <td>{member.name}</td>
              <td>{member.email}</td>
              <td>
                <RoleDisplay
                  role={member.role}
                  environments={member.environments}
                  limitAccessByEnvironment={member.limitAccessByEnvironment}
                />
              </td>
              <td>
                {member.id !== userId && (
                  <>
                    <MoreMenu id={`member-actions-${id}`}>
                      <button
                        className="dropdown-item"
                        onClick={(e) => {
                          e.preventDefault();
                          setRoleModal(member.id);
                        }}
                      >
                        Edit Role
                      </button>
                      {!usingSSO() && (
                        <button
                          className="dropdown-item"
                          onClick={(e) => {
                            e.preventDefault();
                            setPasswordResetModal(member);
                          }}
                        >
                          Reset Password
                        </button>
                      )}
                      <DeleteButton
                        link={true}
                        text="Delete User"
                        useIcon={false}
                        className="dropdown-item"
                        displayName={member.email}
                        onClick={async () => {
                          await apiCall(`/member/${member.id}`, {
                            method: "DELETE",
                          });
                          mutate();
                        }}
                      />
                    </MoreMenu>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn btn-primary mt-3" onClick={onInvite}>
        <span className="h4 pr-2 m-0 d-inline-block align-top">
          <GBAddCircle />
        </span>
        Invite Member
      </button>
    </div>
  );
};

export default MemberList;
