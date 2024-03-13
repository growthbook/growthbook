import { FaQuestionCircle } from "react-icons/fa";
import { useEffect, useState } from "react";
import Toggle from "@front-end/components/Forms/Toggle";
import track from "@front-end/services/track";
import Tooltip from "@front-end/components/Tooltip/Tooltip";
import { useUser } from "@front-end/services/UserContext";
import usePermissions from "@front-end/hooks/usePermissions";
import { useAuth } from "@front-end/services/auth";

export default function AutoApproveMembersToggle({
  mutate,
}: {
  mutate: () => void;
}) {
  const { organization, users } = useUser();
  const permissions = usePermissions();
  const { apiCall } = useAuth();

  const [togglingAutoApprove, setTogglingAutoApprove] = useState(false);

  const [owner, setOwner] = useState(null);
  useEffect(() => {
    if (!users || !organization) return;
    let owner = null;
    const ownerEmail = organization?.ownerEmail;
    if (ownerEmail) {
      // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'ExpandedMember | undefined' is not assignabl... Remove this comment to see the full error message
      owner = [...users.values()].find((user) => user.email === ownerEmail);
    }
    setOwner(owner);
  }, [users, organization]);

  return (
    <div className="mt-3">
      <Toggle
        id="autoApproveMembers"
        // @ts-expect-error TS(2339) If you come across this, please fix it!: Property 'verified' does not exist on type 'never'... Remove this comment to see the full error message
        value={!owner?.verified ? false : !!organization?.autoApproveMembers}
        // @ts-expect-error TS(2339) If you come across this, please fix it!: Property 'verified' does not exist on type 'never'... Remove this comment to see the full error message
        disabled={!permissions.manageTeam || !owner?.verified}
        setValue={async (on) => {
          if (togglingAutoApprove) return;
          if (on && organization?.autoApproveMembers) return;
          if (!on && !organization?.autoApproveMembers) return;

          setTogglingAutoApprove(true);
          try {
            await apiCall(`/organization/autoApproveMembers`, {
              method: "POST",
              body: JSON.stringify({
                state: on,
              }),
            });
            track("Set auto approve members", {
              enabled: on,
            });
          } catch (e) {
            console.error(e);
          }
          setTogglingAutoApprove(false);
          mutate();
        }}
      />
      <div
        className="ml-1"
        style={{ display: "inline-block", verticalAlign: "middle" }}
      >
        <Tooltip body="When new members register using a verified email address matching this organization's domain, automatically add them as active members.">
          Automatically approve new verified users <FaQuestionCircle />
        </Tooltip>
      </div>
      {/* @ts-expect-error TS(2339) If you come across this, please fix it!: Property 'verified' does not exist on type 'never'... Remove this comment to see the full error message */}
      {!owner?.verified && (
        <div className="mt-3">
          <Tooltip
            body={
              <>
                <p>
                  Typically a domain will be considered &quot;verified&quot;
                  when the owner registered via single-sign-on using a company
                  email address.
                </p>
                <p className="mb-0">
                  Get in touch with us if you need help verifying your domain.
                </p>
              </>
            }
          >
            <span className="p-2 alert alert-info">
              This organization&apos;s domain must be verified to enable
              automatic approvals <FaQuestionCircle />
            </span>
          </Tooltip>
        </div>
      )}
    </div>
  );
}
