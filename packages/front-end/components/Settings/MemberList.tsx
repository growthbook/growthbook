import { FC, useState, useContext, ReactElement } from "react";
import {
  FaPlus,
  FaPencilAlt,
  FaUserCheck,
  FaRegEnvelope,
} from "react-icons/fa";
import InviteModal from "./InviteModal";
import { useAuth, MemberRole } from "../../services/auth";
import { UserContext } from "../ProtectedPage";
import DeleteButton from "../DeleteButton";
import Modal from "../Modal";
import RoleSelector from "./RoleSelector";
import React from "react";
import { Member } from "../../pages/settings/team";
import LoadingOverlay from "../LoadingOverlay";

const MemberList: FC<{
  members: Member[];
  mutate: () => void;
}> = ({ members, mutate }) => {
  const [inviting, setInviting] = useState(false);
  const { apiCall } = useAuth();
  const { userId } = useContext(UserContext);
  const [roleModal, setRoleModal] = useState<Member>(null);
  const [role, setRole] = useState<MemberRole>("admin");
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<ReactElement | null>(null);
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

  const onResend = async (email: string) => {
    if (resending) return;
    setResending(true);
    setResendMessage(null);

    const dismissButton = (
      <button
        type="button"
        className="close"
        data-dismiss="alert"
        aria-label="Close"
        onClick={(e) => {
          e.preventDefault();
          setResendMessage(null);
        }}
      >
        <span aria-hidden="true">&times;</span>
      </button>
    );

    try {
      const { status } = await apiCall<{
        status: number;
      }>(`/auth/resetverify`, {
        method: "POST",
        body: JSON.stringify({
          email,
        }),
      });

      if (status !== 200) {
        setResendMessage(
          <div className="alert alert-danger">
            {dismissButton}
            {"Error re-sending the verification email"}
          </div>
        );
      }
    } catch (e) {
      setResendMessage(
        <div className="alert alert-danger">
          {dismissButton}
          {e.message}
        </div>
      );
    }

    setResending(false);
  };

  members.sort(
    (a, b) =>
      (b.status === "verified" ? 1 : -1) - (a.status === "verified" ? 1 : -1)
  );

  return (
    <div className="my-4">
      {inviting && (
        <InviteModal close={() => setInviting(false)} mutate={mutate} />
      )}
      {resending && <LoadingOverlay />}
      {resendMessage}

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
            <th style={{ width: "20%" }}>Name</th>
            <th style={{ width: "30%" }}>Email</th>
            <th style={{ width: "15%" }}>Role</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.id}>
              <td>
                {member.name}
                {member.status === "unverified" && (
                  <>
                    <span className="badge badge-pill ml-2 badge-danger">
                      Unverified
                    </span>
                    <div className="mt-1">
                      <button
                        className="tr-hover btn btn-sm btn-outline-success mr-2"
                        onClick={(e) => {
                          e.preventDefault();
                          (async () => {
                            await apiCall(`/auth/verify`, {
                              method: "POST",
                              body: JSON.stringify({
                                id: member.id,
                                key: member.verificationToken,
                              }),
                            });
                            mutate();
                          })();
                        }}
                      >
                        <FaUserCheck /> Verify
                      </button>
                      <button
                        className="tr-hover btn btn-sm btn-outline-primary mr-2"
                        onClick={(e) => {
                          e.preventDefault();
                          onResend(member.email);
                        }}
                      >
                        <FaRegEnvelope /> Resend Email
                      </button>
                    </div>
                  </>
                )}
              </td>
              <td>{member.email}</td>
              <td>{member.role}</td>
              <td>
                {member.id !== userId && (
                  <>
                    <button
                      className="tr-hover btn btn-outline-primary mr-2"
                      onClick={(e) => {
                        e.preventDefault();
                        setRoleModal(member);
                        setRole(member.role);
                      }}
                    >
                      <FaPencilAlt /> Edit
                    </button>
                    <DeleteButton
                      link={true}
                      className="tr-hover btn btn-outline-danger"
                      displayName={member.email}
                      text="Remove"
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

      <button className="btn btn-success mt-1 mb-3" onClick={onInvite}>
        <FaPlus /> Invite Member
      </button>
    </div>
  );
};

export default MemberList;
