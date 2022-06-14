import React, { FC, useState } from "react";
import InviteModal from "./InviteModal";
import { useAuth } from "../../services/auth";
import useUser from "../../hooks/useUser";
import Modal from "../Modal";
import RoleSelector from "./RoleSelector";
import { GBAddCircle } from "../Icons";
import { MemberRole } from "back-end/types/organization";
import Field from "../Forms/Field";
import { useForm } from "react-hook-form";
import MoreMenu from "../Dropdown/MoreMenu";
import DeleteButton from "../DeleteButton";

type Member = { id: string; name: string; email: string; role: MemberRole };

const MemberList: FC<{
  members: Member[];
  mutate: () => void;
}> = ({ members, mutate }) => {
  const [inviting, setInviting] = useState(false);
  const { apiCall } = useAuth();
  const user = useUser();
  const [roleModal, setRoleModal] = useState<Member>(null);
  const [passwordResetModal, setPasswordResetModal] = useState<Member>(null);
  const [role, setRole] = useState<MemberRole>("admin");
  const [success, setSuccess] = useState(false);
  const form = useForm({
    defaultValues: {
      updatedPassword: "",
    },
  });

  const onInvite = () => {
    setInviting(true);
  };

  const onResetPasswordSubmit = async (formData) => {
    await apiCall(`/member/${passwordResetModal.id}/admin-password-reset`, {
      method: "PUT",
      credentials: "include",
      body: JSON.stringify({ updatedPassword: formData.updatedPassword }),
    });
  };

  const onSubmitChangeRole = async () => {
    await apiCall(`/member/${roleModal.id}/role`, {
      method: "PUT",
      body: JSON.stringify({
        role,
      }),
    });
    mutate();
    setRoleModal(null);
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
        <Modal
          close={() => {
            form.reset();
            setSuccess(false);
            setPasswordResetModal(null);
          }}
          header="Change Password"
          open={true}
          autoCloseOnSubmit={false}
          closeCta={success ? "Close" : "Cancel"}
          submit={
            success
              ? null
              : form.handleSubmit(async (data) => {
                  await onResetPasswordSubmit(data);
                  setSuccess(true);
                })
          }
        >
          <p>
            Change password for <strong>{passwordResetModal.name}</strong>:
          </p>
          {success ? (
            <div className="alert alert-success">
              Password successfully changed.
            </div>
          ) : (
            <Field
              placeholder="Enter a new password"
              type="password"
              required
              minLength={8}
              autoComplete="updated-password"
              {...form.register("updatedPassword")}
            />
          )}
        </Modal>
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
                {member.id !== user.userId && (
                  <>
                    <MoreMenu id="test">
                      <a
                        className="dropdown-item"
                        onClick={(e) => {
                          e.preventDefault();
                          setRoleModal(member);
                          setRole(member.role);
                        }}
                      >
                        Edit Role
                      </a>
                      <a
                        className="dropdown-item"
                        onClick={(e) => {
                          e.preventDefault();
                          setPasswordResetModal(member);
                        }}
                      >
                        Reset Password
                      </a>
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
