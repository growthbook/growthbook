import React, { useState } from "react";
import { OrganizationInterface } from "back-end/types/organization";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import ShowLicenseInfo from "@/components/License/ShowLicenseInfo";
import EditOrganizationModal from "@/components/Settings/EditOrganizationModal";
import { isCloud, isMultiOrg } from "@/services/env";
import { useUser } from "@/services/UserContext";
import usePermissions from "@/hooks/usePermissions";
import Button from "@/components/Radix/Button";
import Callout from "@/components/Radix/Callout";

export default function OrganizationAndLicenseSettings({
  org,
  refreshOrg,
}: {
  org: Partial<OrganizationInterface>;
  refreshOrg: () => Promise<void>;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const permissions = usePermissions();
  // this check isn't strictly necessary, as we check permissions accessing the settings page, but it's a good to be safe
  const canEdit = permissions.check("organizationSettings");
  const { users } = useUser();
  const ownerEmailExists = !!Array.from(users).find(
    (e) => e[1].email === org.ownerEmail
  );

  return (
    <>
      {editOpen && (
        <EditOrganizationModal
          name={org.name || ""}
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
                {!isCloud() && !isMultiOrg() && (
                  <Box>
                    <Text weight="medium">Organization Id: </Text> {org.id}
                  </Box>
                )}
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
