import React, { FC, useState } from "react";
import { FaPencilAlt } from "react-icons/fa";
import InviteModal from "./InviteModal";
import { useAuth } from "../../services/auth";
import useUser from "../../hooks/useUser";
import DeleteButton from "../DeleteButton";
import Modal from "../Modal";
import RoleSelector from "./RoleSelector";
import { GBAddCircle } from "../Icons";
import { MemberRole } from "back-end/types/organization";
import Field from "../Forms/Field";
import { useForm } from "react-hook-form";

type Member = { id: string; name: string; email: string; role: MemberRole };

const MemberList: FC<{
  members: Member[];
  mutate: () => void;
}> = ({ members, mutate }) => {
  const [inviting, setInviting] = useState(false);
  const { apiCall } = useAuth();
  const user = useUser();
  const [roleModal, setRoleModal] = useState<Member>(null);
  const [role, setRole] = useState<MemberRole>("admin");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const form = useForm({
    defaultValues: {
      updatedPassword: "",
    },
  });

  const onInvite = () => {
    setInviting(true);
  };

  const updateOtherUserPassword = async (formData) => {
    const data = {
      loggedInUserId: user.userId,
      loggedInUserRole: user.role,
      userToUpdateId: roleModal.id,
      updatedPassword: formData.updatedPassword,
    };
    try {
      await apiCall("/auth/adminreset", {
        method: "POST",
        credentials: "include",
        body: JSON.stringify(data),
      });
      form.reset();
      setSuccess(true);
    } catch (error) {
      setError(error.message);
    }
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

  const handleClose = () => {
    setRoleModal(null);
    form.reset();
    setSuccess(false);
  };

  return (
    <div className="my-4">
      <h5>Active Members</h5>
      {inviting && (
        <InviteModal close={() => setInviting(false)} mutate={mutate} />
      )}
      {roleModal && (
        <Modal
          close={() => handleClose()}
          header="Edit User"
          open={true}
          closeCta="Close"
        >
          <div className="mb-1">
            <div className=" bg-white p-3 border">
              <p>
                Change role for <strong>{roleModal.name}</strong>:
              </p>
              <RoleSelector
                role={role}
                setRole={setRole}
                onSubmitChangeRole={onSubmitChangeRole}
              />
            </div>
            <div className=" bg-white p-3 border">
              <p>
                Reset password for <strong>{roleModal.name}</strong>:
              </p>
              {success ? (
                <div className="alert alert-success">
                  Password successfully changed.
                </div>
              ) : (
                <>
                  <Field
                    placeholder="Enter a new password"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="updated-password"
                    {...form.register("updatedPassword")}
                    error={error}
                    onChange={() => setError("")}
                  />
                  <button
                    style={{ marginTop: "none" }}
                    type="submit"
                    className="btn btn-primary mt-3 align-middle"
                    onClick={form.handleSubmit(async (data) => {
                      await updateOtherUserPassword(data);
                    })}
                  >
                    Reset Password
                  </button>
                </>
              )}
            </div>
          </div>
        </Modal>
      )}
      <table className="table appbox gbtable table-hover">
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
                    <a
                      href="#"
                      className="tr-hover mr-3"
                      onClick={(e) => {
                        e.preventDefault();
                        setRoleModal(member);
                        setRole(member.role);
                      }}
                    >
                      <FaPencilAlt />
                    </a>
                    <DeleteButton
                      link={true}
                      className="tr-hover"
                      displayName={member.email}
                      onClick={async () => {
                        await apiCall(`/member/${member.id}`, {
                          method: "DELETE",
                        });
                        mutate();
                      }}
                    />
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
