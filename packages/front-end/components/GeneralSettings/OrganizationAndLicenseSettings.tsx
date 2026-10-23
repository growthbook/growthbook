import React, { useState } from "react";
import { OrganizationInterface } from "shared/types/organization";
import { Box, Flex, VisuallyHidden } from "@radix-ui/themes";
import { PiCheck, PiCopy } from "react-icons/pi";
import ShowLicenseInfo from "@/components/License/ShowLicenseInfo";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import { isCloud, isMultiOrg } from "@/services/env";
import { useUser } from "@/services/UserContext";
import usePermissions from "@/hooks/usePermissions";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";
import { useSettingsForm } from "./SettingsFormProvider";
import { SettingsField, SettingsGroup } from "./SettingsGroup";
import styles from "./SettingsSection.module.scss";

export default function OrganizationAndLicenseSettings({
  org,
}: {
  org: Partial<OrganizationInterface>;
}) {
  const { license, users } = useUser();
  const { orgForm } = useSettingsForm();
  const permissions = usePermissions();
  const { performCopy, copySuccess, copySupported } = useCopyToClipboard({
    timeout: 1500,
  });
  // this check isn't strictly necessary, as we check permissions accessing the settings page, but it's a good to be safe
  const canEdit = permissions.check("organizationSettings");
  const ownerEmail = orgForm.watch("ownerEmail");
  const memberEmails = Array.from(users).map(([, user]) => user.email);
  const ownerEmailExists = memberEmails.includes(ownerEmail);
  const [ownerTouched, setOwnerTouched] = useState(false);
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
          {/* Large orgs get a plain email field; a dropdown of every member would be unwieldy. */}
          {memberEmails.length < 100 ? (
            <SelectField
              id="org-owner"
              containerClassName="mb-0"
              value={ownerEmail}
              options={memberEmails.map((e) => ({ value: e, label: e }))}
              disabled={!canEdit}
              onChange={(value) =>
                orgForm.setValue("ownerEmail", value, { shouldDirty: true })
              }
            />
          ) : (
            <Field
              id="org-owner"
              type="email"
              containerClassName="mb-0"
              disabled={!canEdit}
              {...orgForm.register("ownerEmail", {
                onBlur: () => setOwnerTouched(true),
              })}
            />
          )}
          {ownerTouched && !ownerEmailExists && (
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
          {copySupported ? (
            <button
              type="button"
              className={styles.codeChip}
              aria-label="Copy organization ID"
              title={copySuccess ? "Copied" : "Click to copy"}
              onClick={() => org.id && performCopy(org.id)}
            >
              <Flex as="span" align="center" gap="2">
                <Text mono>{org.id}</Text>
                {copySuccess ? <PiCheck aria-hidden /> : <PiCopy aria-hidden />}
              </Flex>
            </button>
          ) : (
            <Box className={styles.codeChip}>
              <Text mono>{org.id}</Text>
            </Box>
          )}
          <VisuallyHidden role="status">
            {copySuccess ? "Copied" : ""}
          </VisuallyHidden>
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
