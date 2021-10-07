import { FC, useState, useContext } from "react";
import { FaPlus, FaPencilAlt } from "react-icons/fa";
import InviteModal from "./InviteModal";
import { useAuth, MemberRole, MemberStatus } from "../../services/auth";
import { UserContext } from "../ProtectedPage";
import DeleteButton from "../DeleteButton";
import Modal from "../Modal";
import RoleSelector from "./RoleSelector";

type Member = {
  id: string;
  name: string;
  email: string;
  role: MemberRole;
  status: MemberStatus;
};

const MemberList: FC<{
  members: Member[];
  mutate: () => void;
}> = ({ members, mutate }) => {
  const [inviting, setInviting] = useState(false);
  const { apiCall } = useAuth();
  const { userId } = useContext(UserContext);
  const [roleModal, setRoleModal] = useState<Member>(null);
  const [role, setRole] = useState<MemberRole>("admin");
  // const [status, setStatus] = useState<MemberStatus>("verified");

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

      <h5>Active Members</h5>
      <table className="table appbox table-hover">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {members.map((member) => {
            if (member.status === "unverified") {
              return;
            }
            return (
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
            );
          })}
        </tbody>
      </table>

      <h5>Pending Members</h5>
      <table className="table appbox table-hover">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {members.map((member) => {
            if (member.status !== "unverified") {
              return;
            }
            return (
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
            );
          })}
        </tbody>
      </table>
      <button className="btn btn-success mt-3" onClick={onInvite}>
        <FaPlus /> Invite Member
      </button>
    </div>
  );
};

export default MemberList;
