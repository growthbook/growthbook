import { useState } from "react";
import { useForm } from "react-hook-form";
import {
  RESERVED_ROLE_IDS,
  getDefaultRole,
  getRoleDisplayName,
} from "shared/permissions";
import { Box, Flex } from "@radix-ui/themes";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import HelperText from "@/ui/HelperText";
import { GroupedValue } from "@/components/Forms/SelectField";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import RoleSelector from "./RoleSelector";

export default function UpdateDefaultRoleForm() {
  const [isDirty, setIsDirty] = useState(false);
  const { refreshOrganization, organization, roles } = useUser();
  const [defaultRoleError, setDefaultRoleError] = useState<string | null>(null);
  const deactivatedRoles = organization.deactivatedRoles || [];

  const { apiCall } = useAuth();
  let roleOptions = [...roles];

  // if the org has custom-roles feature and has deactivated roles, remove those from the roleOptions
  if (deactivatedRoles.length) {
    roleOptions = roleOptions.filter((r) => !deactivatedRoles.includes(r.id));
  }

  const standardOptions: { label: string; value: string }[] = [];
  const customOptions: { label: string; value: string }[] = [];

  roleOptions.forEach((r) => {
    if (RESERVED_ROLE_IDS.includes(r.id)) {
      standardOptions.push({
        label: getRoleDisplayName(r.id, organization),
        value: r.id,
      });
    } else {
      customOptions.push({
        label: getRoleDisplayName(r.id, organization),
        value: r.id,
      });
    }
  });

  const groupedOptions: GroupedValue[] = [];

  if (standardOptions.length) {
    groupedOptions.push({ label: "Standard", options: standardOptions });
  }

  if (customOptions.length) {
    groupedOptions.push({ label: "Custom", options: customOptions });
  }

  const form = useForm({
    defaultValues: {
      defaultRole: getDefaultRole(organization),
    },
  });

  const saveSettings = form.handleSubmit(async (data) => {
    setDefaultRoleError(null);
    try {
      await apiCall<{
        status: number;
        message?: string;
      }>("/organization/default-role", {
        method: "PUT",
        body: JSON.stringify(data),
      });
      refreshOrganization();
    } catch (e) {
      setDefaultRoleError(e.message);
    }
    setIsDirty(false);
  });

  return (
    <Box className="appbox" p="4" mt="5" mb="5">
      <Flex direction={{ initial: "column", sm: "row" }} gap="4">
        <Box width="200px" flexShrink="0">
          <Heading as="h3" size="md" mb="0">
            Default Roles
          </Heading>
        </Box>
        <Box flexGrow="1">
          <Text as="p" color="text-mid" mb="3">
            This is the default role that will be assigned to new users if you
            have auto-join or SCIM enabled. This will not affect any existing
            users.
          </Text>
          <RoleSelector
            value={form.watch("defaultRole")}
            setValue={(value) => {
              setIsDirty(true);
              form.setValue("defaultRole", value);
            }}
          />
          {defaultRoleError ? (
            <HelperText status="error">{defaultRoleError}</HelperText>
          ) : null}
          <Flex justify="end" pt="3">
            <Button
              disabled={!isDirty}
              onClick={async () => {
                if (!isDirty) return;
                await saveSettings();
              }}
            >
              Save
            </Button>
          </Flex>
        </Box>
      </Flex>
    </Box>
  );
}
