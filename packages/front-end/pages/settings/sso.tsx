import { FC } from "react";
import { Box, Flex } from "@radix-ui/themes";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import SSOSettings from "@/components/Settings/SSOSettings";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";

const SSOPage: FC = () => {
  const permissionsUtil = usePermissionsUtil();

  if (!permissionsUtil.canManageOrgSettings()) {
    return (
      <div className="container pagecontents">
        <Callout status="error">
          You do not have access to view this page.
        </Callout>
      </div>
    );
  }

  return (
    <div className="container-fluid pagecontents">
      <Box mx="auto" style={{ maxWidth: 920 }}>
        <Flex align="center" gap="3" mb="1">
          <Heading size="2x-large" as="h1" mb="0">
            Single Sign-On (SSO)
          </Heading>
          <Badge label="Enterprise" color="amber" variant="soft" />
        </Flex>
        <Box mb="5" style={{ maxWidth: 560 }}>
          <Text color="text-mid">
            Configure single sign-on so members of your organization can sign in
            through your identity provider.
          </Text>
        </Box>
        <SSOSettings />
      </Box>
    </div>
  );
};

export default SSOPage;
