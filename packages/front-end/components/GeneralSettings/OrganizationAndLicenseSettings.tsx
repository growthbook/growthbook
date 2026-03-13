import React, { useState } from "react";
import {
  OrganizationInterface,
  UserNameDisplayFormat,
} from "shared/types/organization";
import { useFormContext } from "react-hook-form";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import ShowLicenseInfo from "@/components/License/ShowLicenseInfo";
import EditOrganizationModal from "@/components/Settings/EditOrganizationModal";
import SelectField from "@/components/Forms/SelectField";
import { isCloud, isMultiOrg } from "@/services/env";
import { useUser } from "@/services/UserContext";
import usePermissions from "@/hooks/usePermissions";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";

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
  const form = useFormContext<{
    userNameDisplayFormat?: UserNameDisplayFormat;
  }>();

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
      <Box className="appbox" p="5">
        <Flex justify="start" gap="4">
          <Box width="220px" flexShrink="0">
            <Heading as="h4" size="4">
              Organization Settings
            </Heading>
          </Box>
          <Box flexGrow="1">
            <Flex justify="between" mb="3">
              <Flex gap="4" direction="column">
                <Box>
                  <Text weight="medium">Name: </Text> {org.name}
                </Box>
                <Box
                  title={
                    !ownerEmailExists
                      ? "Owner email does not exist in the organization"
                      : ""
                  }
                >
                  <Text weight="medium">Owner:</Text> {org.ownerEmail}
                  {!ownerEmailExists && (
                    <a onClick={() => setEditOpen(true)}>
                      <Callout status="error" mt="4">
                        Owner email does not exist in the organization. Click to
                        edit.
                      </Callout>
                    </a>
                  )}
                </Box>
                <Box>
                  <Text weight="medium">Organization Id: </Text> {org.id}
                </Box>
                {showInstallationName && (
                  <Box>
                    <Text weight="medium">Installation Name: </Text>{" "}
                    {installationName}
                  </Box>
                )}
                <Box maxWidth="420px">
                  <Text
                    as="label"
                    size="2"
                    className="font-weight-semibold"
                    htmlFor="userNameDisplayFormat"
                  >
                    Site-wide owner and user name display format
                  </Text>
                  <Text as="p" size="2" color="gray" mb="2">
                    Applies across the app to owner selectors and owner/user
                    labels.
                  </Text>
                  <SelectField
                    id="userNameDisplayFormat"
                    value={form.watch("userNameDisplayFormat") || "fullName"}
                    disabled={!canEdit}
                    options={[
                      {
                        label: "Full name (e.g. Alice Johnson)",
                        value: "fullName",
                      },
                      {
                        label: "Given name only (e.g. Alice)",
                        value: "givenName",
                      },
                    ]}
                    onChange={(v) =>
                      form.setValue(
                        "userNameDisplayFormat",
                        v as UserNameDisplayFormat,
                        {
                          shouldDirty: true,
                        },
                      )
                    }
                    sort={false}
                  />
                </Box>
              </Flex>
              {canEdit && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditOpen(true);
                  }}
                >
                  Edit
                </Button>
              )}
            </Flex>
          </Box>
        </Flex>
        {(isCloud() || !isMultiOrg()) && (
          <ShowLicenseInfo showInput={!isCloud()} />
        )}
      </Box>
    </>
  );
}
