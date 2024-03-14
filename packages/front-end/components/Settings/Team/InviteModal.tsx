import { FC, useState } from "react";
import { useForm } from "react-hook-form";
import { MemberRoleWithProjects } from "back-end/types/organization";
import Link from "next/link";
import track from "@/services/track";
import Modal from "@/components/Modal";
import { useAuth } from "@/services/auth";
import useStripeSubscription from "@/hooks/useStripeSubscription";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useUser } from "@/services/UserContext";
import StringArrayField from "@/components/Forms/StringArrayField";
import UpgradeModal from "@/components/Settings/UpgradeModal";
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
  const { accountPlan, license, seatsInUse } = useUser();

  const form = useForm<{
    email: string[];
    roleInfo: MemberRoleWithProjects;
  }>({
    defaultValues: {
      email: [],
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

  const [showContactSupport, setShowContactSupport] = useState(
    license && license.hardCap && license.seats <= seatsInUse
  );

  // Hit their free limit and needs to upgrade to invite more team members
  if (showUpgradeModal) {
    // The <UpgradeModal> won't actually render for these plans, so show a generic modal instead
    if (["pro", "pro_sso", "enterprise"].includes(accountPlan ?? "")) {
      return (
        <Modal open={true} close={close} size="md">
          <div className="text-center my-3">
            <div className="strong">{showUpgradeModal}</div>
            <div className="mt-3">
              To upgrade, please visit the{" "}
              <Link href="/settings/billing">billing</Link> page.
            </div>
          </div>
        </Modal>
      );
    }
    return (
      <UpgradeModal
        close={close}
        source="invite team"
        reason={showUpgradeModal}
      />
    );
  }

  // Hit a hard cap and needs to contact sales to increase the number of seats on their license
  if (showContactSupport) {
    return (
      <Modal open={true} close={close} size="md" header={"Reached seat limit"}>
        <div className="my-3">
          Whoops! You reached the seat limit on your license. To increase your
          number of seats, please contact{" "}
          <a href="mailto:sales@growthbook.io" target="_blank" rel="noreferrer">
            sales@growthbook.io
          </a>
          .
        </div>
      </Modal>
    );
  }

  const onSubmit = form.handleSubmit(async (value) => {
    const { email: emails } = value;

    if (
      canSubscribe &&
      activeAndInvitedUsers + value.email.length > freeSeats
    ) {
      setShowUpgradeModal("Whoops! You reached your free seat limit.");
      return;
    }

    if (
      license &&
      license.hardCap &&
      license.seats < seatsInUse + value.email.length
    ) {
      setShowContactSupport(true);
      return;
    }

    const failed: InviteResult[] = [];
    const succeeded: InviteResult[] = [];

    for (const email of emails) {
      const resp = await apiCall<{
        emailSent: boolean;
        inviteUrl: string;
        status: number;
        message?: string;
      }>(`/invite`, {
        method: "POST",
        body: JSON.stringify({
          email,
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
        successfulInvites.length || failedInvites.length ? "Close" : "Cancel"
      }
      autoCloseOnSubmit={false}
      submit={
        successfulInvites.length || failedInvites.length ? undefined : onSubmit
      }
    >
      {successfulInvites.length || failedInvites.length ? (
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
          <StringArrayField
            required
            label="Email Address"
            value={form.watch("email")}
            onChange={(emails) => {
              form.setValue("email", emails);
            }}
            helpText="Enter a list of emails to invite multiple members at once."
            type="email"
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
