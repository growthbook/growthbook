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

type Member = { id: string; name: string; email: string; role: MemberRole };

const MemberList: FC<{
  members: Member[];
  mutate: () => void;
}> = ({ members, mutate }) => {
  const [inviting, setInviting] = useState(false);
  const { apiCall } = useAuth();
  const { userId } = useUser();
  const [roleModal, setRoleModal] = useState<Member>(null);
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
                {member.id !== userId && (
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
