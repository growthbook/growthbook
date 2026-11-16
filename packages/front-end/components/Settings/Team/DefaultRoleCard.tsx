import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { getDefaultRole } from "shared/permissions";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { RoleRulesSummary } from "./RoleRulesSummary";
import RoleRulesTable from "./RoleRulesTable";

export default function DefaultRoleCard() {
  const { organization, permissionsUtil, refreshOrganization } = useUser();
  const { apiCall } = useAuth();
  const defaultRole = getDefaultRole(organization);
  const [draft, setDraft] = useState(defaultRole);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return (
      <Flex align="center" justify="between" gap="3" px="4" py="3">
        <Box>
          <Heading as="h3" size="sm" weight="medium" m="0">
            Default role for new members
          </Heading>
          <Text as="div" color="text-mid">
            <RoleRulesSummary value={defaultRole} />
          </Text>
        </Box>
        <Button
          variant="ghost"
          disabled={!permissionsUtil.canManageTeam()}
          onClick={() => {
            setDraft(defaultRole);
            setError(null);
            setEditing(true);
          }}
        >
          Edit
        </Button>
      </Flex>
    );
  }

  return (
    <Box px="4" py="3" style={{ background: "var(--slate-2)" }}>
      <Heading as="h3" size="sm" weight="medium" m="0">
        Default role for new members
      </Heading>
      <Text as="p" color="text-mid" mb="3">
        Applied to new users who join through auto-join or SCIM. Existing
        members are unaffected.
      </Text>
      <RoleRulesTable
        value={draft}
        setValue={setDraft}
        footerEnd={
          <Flex gap="3" align="center">
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              setError={setError}
              onClick={async () => {
                await apiCall("/organization/default-role", {
                  method: "PUT",
                  body: JSON.stringify({ defaultRole: draft }),
                });
                await refreshOrganization();
                setEditing(false);
              }}
            >
              Save
            </Button>
          </Flex>
        }
      />
      {error && (
        <HelperText status="error" mt="2">
          {error}
        </HelperText>
      )}
    </Box>
  );
}
