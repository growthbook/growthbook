import React, { FC, useState, ReactElement } from "react";
import { Invite, MemberRoleInfo } from "back-end/types/organization";
import { FaCheck, FaTimes } from "react-icons/fa";
import { datetime } from "shared/dates";
import ConfirmModal from "@/components/ConfirmModal";
import { roleHasAccessToEnv, useAuth } from "@/services/auth";
import LoadingOverlay from "@/components/LoadingOverlay";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import { useEnvironments } from "@/services/features";
import ProjectBadges from "@/components/ProjectBadges";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import ChangeRoleModal from "./ChangeRoleModal";

type ChangeRoleInfo = {
  roleInfo: MemberRoleInfo;
  displayInfo: string;
  key: string;
};

const InviteList: FC<{
  invites: Invite[];
  mutate: () => void;
  project: string;
}> = ({ invites, mutate, project }) => {
  const [deleteInvite, setDeleteInvite] = useState<{
    key: string;
    email: string;
  } | null>(null);
  const { apiCall } = useAuth();
  // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type 'null' is not assignable to param... Remove this comment to see the full error message
  const [roleModal, setRoleModal] = useState<ChangeRoleInfo>(null);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<ReactElement | null>(null);

  const { organization } = useUser();

  const { projects } = useDefinitions();
  const environments = useEnvironments();

  const onResend = async (key: string, email: string) => {
    if (resending) return;
    setResending(true);
    setResendMessage(null);

    const dismissButton = (
      <button
        type="button"
        className="close"
        data-dismiss="alert"
        aria-label="关闭"
        onClick={(e) => {
          e.preventDefault();
          setResendMessage(null);
        }}
      >
        <span aria-hidden="true">&times;</span>
      </button>
    );

    try {
      const { status, message, inviteUrl, emailSent } = await apiCall<{
        status: number;
        message: string;
        inviteUrl: string;
        emailSent: boolean;
      }>(`/invite/resend`, {
        method: "POST",
        body: JSON.stringify({
          key,
        }),
      });

      if (status !== 200) {
        setResendMessage(
          <div className="alert alert-danger">
            {dismissButton}
            {message || "重新发送邀请时出错"}
          </div>
        );
      } else if (!emailSent) {
        setResendMessage(
          <div className="alert alert-info">
            {dismissButton}
            <p>
              未能向 <strong>{email}</strong> 发送电子邮件。你可以手动将以下邀请链接发送给他们：
            </p>
            <div>
              <code>{inviteUrl}</code>
            </div>
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

  return (
    <div>
      <h5>待处理的邀请{` (${invites.length})`}</h5>
      <div className="text-muted mb-2">
        已发送但尚未被接受的邀请。<strong>被邀请的用户会计入计划席位限制。</strong>
      </div>
      {roleModal && (
        <ChangeRoleModal
          displayInfo={roleModal.displayInfo}
          roleInfo={roleModal.roleInfo}
          // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type 'null' is not assignable to param... Remove this comment to see the full error message
          close={() => setRoleModal(null)}
          onConfirm={async (value) => {
            await apiCall(`/invite/${roleModal.key}/role`, {
              method: "PUT",
              body: JSON.stringify(value),
            });
            mutate();
          }}
        />
      )}
      <ConfirmModal
        title={deleteInvite ? `移除 ${deleteInvite.email}?` : "移除邀请"}
        subtitle=""
        yesText="移除"
        noText="取消"
        modalState={deleteInvite !== null}
        setModalState={() => setDeleteInvite(null)}
        onConfirm={async () => {
          // @ts-expect-error TS(2339) If you come across this, please fix it!: Property 'key' does not exist on type '{ key: stri... Remove this comment to see the full error message
          const { key } = deleteInvite;
          setDeleteInvite(null);
          await apiCall(`/invite`, {
            method: "DELETE",
            body: JSON.stringify({
              key,
            }),
          });
          mutate();
        }}
      />
      {resending && <LoadingOverlay />}
      {resendMessage}
      <div style={{ overflowY: "auto" }}>
        <table className="table appbox gbtable table-hover">
          <thead>
            <tr>
              <th>电子邮件</th>
              <th>邀请日期</th>
              <th>{project ? "项目角色" : "全局角色"}</th>
              {!project && <th>项目角色</th>}
              {environments.map((env) => (
                <th key={env.id}>{env.id}</th>
              ))}
              <th style={{ width: 50 }} />
            </tr>
          </thead>
          <tbody>
            {invites.map(({ email, key, dateCreated, ...member }) => {
              const roleInfo =
                (project &&
                  member.projectRoles?.find((r) => r.project === project)) ||
                member;
              return (
                <tr key={key}>
                  <td>{email}</td>
                  <td>{datetime(dateCreated)}</td>
                  <td>{roleInfo.role}</td>
                  {!project && (
                    <td className="col-3">
                      {member.projectRoles?.map((pr) => {
                        const p = projects.find((p) => p.id === pr.project);
                        if (p?.name) {
                          return (
                            <div key={`project-tags-${p.id}`}>
                              <ProjectBadges
                                resourceType="member"
                                projectIds={[p.id]}
                                className="badge-ellipsis short align-middle font-weight-normal"
                              />{" "}
                              — {pr.role}
                            </div>
                          );
                        }
                        return null;
                      })}
                    </td>
                  )}
                  {environments.map((env) => {
                    const access = roleHasAccessToEnv(
                      roleInfo,
                      env.id,
                      organization
                    );
                    return (
                      <td key={env.id}>
                        {access === "N/A" ? (
                          <span className="text-muted">N/A</span>
                        ) : access === "yes" ? (
                          <FaCheck className="text-success" />
                        ) : (
                          <FaTimes className="text-danger" />
                        )}
                      </td>
                    );
                  })}
                  <td>
                    <MoreMenu>
                      <button
                        className="dropdown-item"
                        onClick={(e) => {
                          e.preventDefault();
                          setRoleModal({
                            key,
                            displayInfo: email,
                            roleInfo,
                          });
                        }}
                      >
                        编辑角色
                      </button>
                      <button
                        className="dropdown-item"
                        onClick={(e) => {
                          e.preventDefault();
                          onResend(key, email);
                        }}
                      >
                        重新发送邀请
                      </button>
                      <button
                        className="dropdown-item"
                        onClick={(e) => {
                          e.preventDefault();
                          setDeleteInvite({ email, key });
                          setResendMessage(null);
                        }}
                      >
                        移除
                      </button>
                    </MoreMenu>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default InviteList;
