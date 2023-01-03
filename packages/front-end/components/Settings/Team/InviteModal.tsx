import { FC, useState } from "react";
import { useForm } from "react-hook-form";
import { MemberRoleWithProjects } from "back-end/types/organization";
import track from "@/services/track";
import Field from "@/components/Forms/Field";
import Modal from "@/components/Modal";
import { useAuth } from "@/services/auth";
import useStripeSubscription from "@/hooks/useStripeSubscription";
import useOrgSettings from "@/hooks/useOrgSettings";
import UpgradeModal from "../UpgradeModal";
import RoleSelector from "./RoleSelector";
import InviteModalSubscriptionInfo from "./InviteModalSubscriptionInfo";

type InviteResult = {
  email: string;
  inviteUrl: string;
};

const InviteModal: FC<{ mutate: () => void; close: () => void }> = ({
  mutate,
  close,
}) => {
  const { defaultRole } = useOrgSettings();

  const form = useForm<{
    email: string;
    roleInfo: MemberRoleWithProjects;
  }>({
    defaultValues: {
      email: "",
      roleInfo: {
        role: "admin",
        limitAccessByEnvironment: false,
        environments: [],
        projectRoles: [],
        ...defaultRole,
      },
    },
  });
  const [successfulInvites, setSuccessfulInvites] = useState<InviteResult[]>(
    []
  );
  const [failedInvites, setFailedInvites] = useState<InviteResult[]>([]);
  const { apiCall } = useAuth();
  const {
    freeSeats,
    canSubscribe,
    activeAndInvitedUsers,
  } = useStripeSubscription();
  const [showUpgradeModal, setShowUpgradeModal] = useState(
    canSubscribe && activeAndInvitedUsers >= freeSeats
      ? "Whoops! You reached your free seat limit."
      : ""
  );

  // Hit their free limit and needs to upgrade to invite more team members
  if (showUpgradeModal) {
    return (
      <UpgradeModal
        close={close}
        source="invite team"
        reason={showUpgradeModal}
      />
    );
  }

  const onSubmit = form.handleSubmit(async (value) => {
    const inviteArr = value.email.split(",");

    if (canSubscribe && activeAndInvitedUsers + inviteArr.length > freeSeats) {
      setShowUpgradeModal("Whoops! You reached your free seat limit.");
      return;
    }

    const failed: InviteResult[] = [];
    const succeeded: InviteResult[] = [];

    for (const email of inviteArr) {
      const resp = await apiCall<{
        emailSent: boolean;
        inviteUrl: string;
        status: number;
        message?: string;
      }>(`/invite`, {
        method: "POST",
        body: JSON.stringify({
          email: email,
          ...value.roleInfo,
        }),
      });

      const result: InviteResult = {
        email,
        inviteUrl: resp.inviteUrl,
      };
      if (resp.emailSent) {
        succeeded.push(result);
      } else {
        failed.push(result);
      }

      track("Team Member Invited", {
        emailSent: resp.emailSent,
        role: value.roleInfo.role,
      });
    }
    setSuccessfulInvites(succeeded);
    setFailedInvites(failed);

    mutate();
  });

  return (
    <Modal
      close={close}
      header="Invite Member"
      open={true}
      cta="Invite"
      closeCta={
        successfulInvites.length > 0 || failedInvites.length > 0
          ? "Close"
          : "Cancel"
      }
      autoCloseOnSubmit={false}
      submit={
        successfulInvites.length > 0 || failedInvites.length > 0
          ? null
          : onSubmit
      }
    >
      {successfulInvites.length > 0 || failedInvites.length > 0 ? (
        <>
          {successfulInvites.length === 1 && (
            <div className="alert alert-success" role="alert">
              Successfully invited <strong>{successfulInvites[0].email}</strong>
              !
            </div>
          )}
          {successfulInvites.length > 1 && (
            <div className="alert alert-success" role="alert">
              <strong>Successfully invited the following members:</strong>
              <div className="pt-2">
                <ul>
                  {successfulInvites.map((successfulInvite) => {
                    return (
                      <li key={successfulInvite.inviteUrl}>
                        {successfulInvite.email}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          )}
          {failedInvites.length === 1 && (
            <>
              <div className="alert alert-danger">
                Failed to send invite email to{" "}
                <strong>{failedInvites[0].email}</strong>
              </div>
              <p>You can manually send them the following invite link:</p>
              <div className="mb-3">
                <code>{failedInvites[0].inviteUrl}</code>
              </div>
            </>
          )}
          {failedInvites.length > 1 && (
            <>
              <div className="alert alert-danger" role="alert">
                <strong>
                  Whoops! We weren&apos;t able to email the following members:
                </strong>
                <div className="pt-2">
                  <ul>
                    {failedInvites.map((failedInvite) => {
                      return (
                        <li key={failedInvite.inviteUrl}>
                          {failedInvite.email}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
              <div className="pl-2 pr-2">
                To manually send a member their invite link, close this modal
                and click the 3 dots next to each member and select &apos;Resend
                Invite&apos;.
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <Field
            label="Email Address"
            required
            type="email"
            multiple={true}
            helpText="Enter a comma separated list of emails to invite multiple members at once."
            {...form.register("email")}
          />
          <RoleSelector
            value={form.watch("roleInfo")}
            setValue={(value) => form.setValue("roleInfo", value)}
            showUpgradeModal={() =>
              setShowUpgradeModal("To enable advanced permissioning,")
            }
          />
          <InviteModalSubscriptionInfo />
        </>
      )}
    </Modal>
  );
};

export default InviteModal;
