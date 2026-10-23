import React from "react";
import { OrganizationInterface } from "shared/types/organization";
import { Box } from "@radix-ui/themes";
import ShowLicenseInfo from "@/components/License/ShowLicenseInfo";
import Field from "@/components/Forms/Field";
import { isCloud, isMultiOrg } from "@/services/env";
import { useUser } from "@/services/UserContext";
import usePermissions from "@/hooks/usePermissions";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";
import { useSettingsForm } from "./SettingsFormProvider";
import { SettingsField, SettingsGroup } from "./SettingsGroup";

export default function OrganizationAndLicenseSettings({
  org,
}: {
  org: Partial<OrganizationInterface>;
}) {
  const { license, users } = useUser();
  const { orgForm } = useSettingsForm();
  const permissions = usePermissions();
  // this check isn't strictly necessary, as we check permissions accessing the settings page, but it's a good to be safe
  const canEdit = permissions.check("organizationSettings");
  const ownerEmail = orgForm.watch("ownerEmail");
  const ownerEmailExists = !!Array.from(users).find(
    (e) => e[1].email === ownerEmail,
  );
  const showInstallationName =
    license?.plan === "enterprise" && !isCloud() && isMultiOrg();

  return (
    <>
      <SettingsGroup
        id="org-details"
        title="Organization"
        description="Shown to members across the app."
        keywords="organization name owner email id installation support"
      >
        <SettingsField htmlFor="org-name" label="Organization name">
          <Field
            id="org-name"
            containerClassName="mb-0"
            disabled={!canEdit}
            {...orgForm.register("name")}
          />
        </SettingsField>
        <SettingsField
          htmlFor="org-owner"
          label="Owner"
          help="Email of the person who owns this organization."
        >
          <Field
            id="org-owner"
            type="email"
            containerClassName="mb-0"
            disabled={!canEdit}
            {...orgForm.register("ownerEmail")}
          />
          {!ownerEmailExists && (
            <HelperText status="error" size="sm" mt="1">
              This email is not associated with any user in your organization.
            </HelperText>
          )}
        </SettingsField>
        {showInstallationName && (
          <SettingsField htmlFor="org-installation" label="Installation name">
            <Field
              id="org-installation"
              containerClassName="mb-0"
              disabled={!canEdit}
              {...orgForm.register("installationName")}
            />
          </SettingsField>
        )}
        <SettingsField
          label="Organization ID"
          help="Use this ID when contacting support or calling the API."
        >
          <Box>
            <Text mono>{org.id}</Text>
          </Box>
        </SettingsField>
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
