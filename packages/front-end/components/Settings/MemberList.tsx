import React, { FC, useState } from "react";
import InviteModal from "./InviteModal";
import { useAuth } from "../../services/auth";
import useUser from "../../hooks/useUser";
import DeleteButton from "../DeleteButton";
import Modal from "../Modal";
import RoleSelector from "./RoleSelector";
import { GBAddCircle } from "../Icons";
import { MemberRole } from "back-end/types/organization";
import MoreMenu from "../Dropdown/MoreMenu";
import { isCloud } from "../../services/env";
import AdminSetPasswordModal from "./AdminSetPasswordModal";

export type MemberInfo = {
  id: string;
  name: string;
  email: string;
  role: MemberRole;
};

const MemberList: FC<{
  members: MemberInfo[];
  mutate: () => void;
}> = ({ members, mutate }) => {
  const [inviting, setInviting] = useState(false);
  const { apiCall } = useAuth();
  const { userId } = useUser();
  const [roleModal, setRoleModal] = useState<MemberInfo>(null);
  const [passwordResetModal, setPasswordResetModal] = useState<MemberInfo>(
    null
  );
  const [role, setRole] = useState<MemberRole>("admin");

  const onInvite = () => {
    setInviting(true);
  };

  const onSubmitChangeRole = async () => {
    await apiCall(`/member/${roleModal.id}/role`, {
      method: "PUT",
      body: JSON.stringify({
        role,
      }),
    });
    mutate();
  };

  return (
    <div className="my-4">
      <h5>Active Members</h5>
      {inviting && (
        <InviteModal close={() => setInviting(false)} mutate={mutate} />
      )}
      {roleModal && (
        <Modal
          close={() => setRoleModal(null)}
          header="Change Role"
          open={true}
          submit={onSubmitChangeRole}
        >
          <p>
            Change role for <strong>{roleModal.name}</strong>:
          </p>
          <RoleSelector role={role} setRole={setRole} />
        </Modal>
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
          {members.map((member) => (
            <tr key={member.id}>
              <td>{member.name}</td>
              <td>{member.email}</td>
              <td>{member.role}</td>
              <td>
                {member.id !== userId && (
                  <>
                    <MoreMenu id="test">
                      <button
                        className="dropdown-item"
                        onClick={(e) => {
                          e.preventDefault();
                          setRoleModal(member);
                          setRole(member.role);
                        }}
                      >
                        Edit Role
                      </button>
                      {!isCloud() && (
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
