import React, { useState } from "react";
import { OrganizationInterface } from "shared/types/organization";
import { Box, Flex } from "@radix-ui/themes";
import ShowLicenseInfo from "@/components/License/ShowLicenseInfo";
import EditOrganizationModal from "@/components/Settings/EditOrganizationModal";
import { isCloud, isMultiOrg } from "@/services/env";
import { useUser } from "@/services/UserContext";
import usePermissions from "@/hooks/usePermissions";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import { SettingsField, SettingsGroup } from "./SettingsGroup";

export default function OrganizationAndLicenseSettings({
  org,
  refreshOrg,
}: {
  org: Partial<OrganizationInterface>;
  refreshOrg: () => Promise<void>;
}) {
  const { installationName, license } = useUser();
  const [editOpen, setEditOpen] = useState(false);
  const permissions = usePermissions();
  // this check isn't strictly necessary, as we check permissions accessing the settings page, but it's a good to be safe
  const canEdit = permissions.check("organizationSettings");
  const { users } = useUser();
  const ownerEmailExists = !!Array.from(users).find(
    (e) => e[1].email === org.ownerEmail,
  );
  const showInstallationName =
    license?.plan === "enterprise" && !isCloud() && isMultiOrg();

  return (
    <>
      {editOpen && (
        <EditOrganizationModal
          name={org.name || ""}
          installationName={installationName || ""}
          ownerEmail={org.ownerEmail || ""}
          close={() => setEditOpen(false)}
          mutate={refreshOrg}
        />
      )}
      <SettingsGroup
        id="org-details"
        title="Organization"
        description="Shown to members across the app."
        keywords="organization name owner email id installation support"
      >
        <Flex justify="between" align="start" gap="4">
          <Flex direction="column" gap="4">
            <SettingsField label="Organization name">
              <Text>{org.name}</Text>
            </SettingsField>
            <SettingsField
              label="Owner"
              help="Email of the person who owns this organization."
            >
              <Text>{org.ownerEmail}</Text>
              {!ownerEmailExists && (
                <a onClick={() => setEditOpen(true)}>
                  <Callout status="error" mt="2">
                    Owner email does not exist in the organization. Click to
                    edit.
                  </Callout>
                </a>
              )}
            </SettingsField>
            <SettingsField
              label="Organization ID"
              help="Use this ID when contacting support or calling the API."
            >
              <Text mono>{org.id}</Text>
            </SettingsField>
            {showInstallationName && (
              <SettingsField label="Installation name">
                <Text>{installationName}</Text>
              </SettingsField>
            )}
          </Flex>
          {canEdit && (
            <Box flexShrink="0">
              <Button variant="ghost" onClick={() => setEditOpen(true)}>
                Edit
              </Button>
            </Box>
          )}
        </Flex>
      </SettingsGroup>
      {(isCloud() || !isMultiOrg()) && (
        <SettingsGroup
          id="org-license"
          title="License"
          description="Your current GrowthBook plan."
          keywords="license plan seats expires key enterprise pro"
        >
          <ShowLicenseInfo showInput={!isCloud()} showHeading={false} />
        </SettingsGroup>
      )}
    </>
  );
}
