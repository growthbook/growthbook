import { FaQuestionCircle } from "react-icons/fa";
import { useEffect, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { ExpandedMember } from "back-end/types/organization";
import Switch from "@/ui/Switch";
import track from "@/services/track";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useUser } from "@/services/UserContext";
import usePermissions from "@/hooks/usePermissions";
import { useAuth } from "@/services/auth";

export default function AutoApproveMembersToggle({
  mutate,
}: {
  mutate: () => void;
}) {
  const { organization, users } = useUser();
  const permissions = usePermissions();
  const { apiCall } = useAuth();

  const [togglingAutoApprove, setTogglingAutoApprove] = useState(false);

  const [owner, setOwner] = useState<ExpandedMember | null>(null);
  useEffect(() => {
    if (!users || !organization) return;
    let owner: ExpandedMember | null | undefined = null;
    const ownerEmail = organization?.ownerEmail;
    if (ownerEmail) {
      owner = [...users.values()].find((user) => user.email === ownerEmail);
    }
    setOwner(owner ?? null);
  }, [users, organization]);

  return (
    <div className="mt-3">
      <Flex gap="1">
        <Switch
          id="autoApproveMembers"
          value={!owner?.verified ? false : !!organization?.autoApproveMembers}
          disabled={!permissions.manageTeam || !owner?.verified}
          label="Automatically approve new verified users"
          onChange={async (on) => {
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
        <Tooltip body="When new members register using a verified email address matching this organization's domain, automatically add them as active members." />
      </Flex>
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
