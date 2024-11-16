import { FC, useEffect, useState } from "react";
import { useRouter } from "next/router";
import InviteList from "@/components/Settings/Team/InviteList";
import MemberList from "@/components/Settings/Team/MemberList";
import { redirectWithTimeout, useAuth } from "@/services/auth";
import SSOSettings from "@/components/Settings/SSOSettings";
import { useUser } from "@/services/UserContext";
import usePermissions from "@/hooks/usePermissions";
import { useDefinitions } from "@/services/DefinitionsContext";
import SelectField from "@/components/Forms/SelectField";
import OrphanedUsersList from "@/components/Settings/Team/OrphanedUsersList";
import PendingMemberList from "@/components/Settings/Team/PendingMemberList";
import { isCloud, isMultiOrg } from "@/services/env";
import AutoApproveMembersToggle from "@/components/Settings/Team/AutoApproveMembersToggle";
import UpdateDefaultRoleForm from "@/components/Settings/Team/UpdateDefaultRoleForm";
import VerifyingEmailModal from "@/components/Settings/UpgradeModal/VerifyingEmailModal";
import PleaseVerifyEmailModal from "@/components/Settings/UpgradeModal/PleaseVerifyEmailModal";
import LicenseSuccessModal from "@/components/Settings/UpgradeModal/LicenseSuccessModal";
import track from "@/services/track";

export const MembersTabView: FC = () => {
  const {
    refreshOrganization,
    enterpriseSSO,
    organization,
    hasCommercialFeature,
  } = useUser();

  const { project, projects } = useDefinitions();

  const [currentProject, setCurrentProject] = useState(project || "");
  const [error, setError] = useState("");

  const permissions = usePermissions();

  const router = useRouter();
  const { apiCall } = useAuth();
  const { license } = useUser();

  // 在Stripe结账后重定向到此页面时将会设置
  const checkoutSessionId = String(
    router.query["subscription-success-session"] || ""
  );

  const [justSubscribedForPro, setJustSubscribedForPro] = useState(false);
  useEffect(() => {
    if (!checkoutSessionId) return;
    setJustSubscribedForPro(true);

    // 确保数据库中有订阅信息（以防Stripe webhook失败）
    apiCall(`/subscription/success`, {
      method: "POST",
      body: JSON.stringify({
        checkoutSessionId,
      }),
    })
      .then(() => {
        refreshOrganization();
        router.replace(router.pathname, router.pathname, { shallow: true });
      })
      .catch((e) => {
        console.error(e);
      });
  }, [apiCall, checkoutSessionId, refreshOrganization, router]);

  const ssoConnection = enterpriseSSO;

  if (!permissions.manageTeam) {
    return (
      <div className="container pagecontents">
        <div className="alert alert-danger">
          您无权查看此页面。
        </div>
      </div>
    );
  }

  const reenterEmailOnStripe = async () => {
    setError("");
    try {
      const res = await apiCall<{ url: string }>(`/subscription/manage`, {
        method: "POST",
      });
      if (res && res.url) {
        track("在Stripe重新输入邮箱");
        await redirectWithTimeout(res.url);
      } else {
        setError("未知响应");
      }
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="container-fluid pagecontents">
      <VerifyingEmailModal />
      {justSubscribedForPro && !isCloud() && !license?.emailVerified && (
        <PleaseVerifyEmailModal
          close={() => setJustSubscribedForPro(false)}
          plan="Pro"
          isTrial={false}
          error={error}
          reenterEmail={reenterEmailOnStripe}
        />
      )}
      {justSubscribedForPro && (isCloud() || license?.emailVerified) && (
        <LicenseSuccessModal
          plan={"Pro"}
          close={() => setJustSubscribedForPro(false)}
          header={`🎉 欢迎使用Growthbook专业版`}
          isTrial={license?.isTrial}
        />
      )}
      <SSOSettings ssoConnection={ssoConnection || null} />
      <h1>团队成员</h1>
      {projects.length > 0 && (
        <div className="row align-items-center">
          <div className="col-auto">查看各项目的角色和权限</div>
          <div className="col-auto">
            <SelectField
              value={currentProject}
              onChange={(value) => setCurrentProject(value)}
              options={projects.map((p) => ({
                label: p.name,
                value: p.id,
              }))}
              initialOption="所有项目"
            />
          </div>
        </div>
      )}
      {isMultiOrg() && (
        <AutoApproveMembersToggle mutate={refreshOrganization} />
      )}
      <MemberList
        mutate={refreshOrganization}
        project={currentProject}
        canEditRoles={true}
        canDeleteMembers={true}
        canInviteMembers={true}
      />
      {organization &&
        organization.invites &&
        organization.invites.length > 0 && (
          <InviteList
            invites={organization.invites}
            mutate={refreshOrganization}
            project={currentProject}
          />
        )}
      {organization &&
        organization.pendingMembers &&
        organization.pendingMembers.length > 0 && (
          <PendingMemberList
            pendingMembers={organization.pendingMembers}
            mutate={refreshOrganization}
            project={currentProject}
          />
        )}
      {!isMultiOrg() && (
        <OrphanedUsersList
          mutateUsers={refreshOrganization}
          numUsersInAccount={organization.members?.length || 0}
        />
      )}
      {hasCommercialFeature("sso") ? <UpdateDefaultRoleForm /> : null}
    </div>
  );
};