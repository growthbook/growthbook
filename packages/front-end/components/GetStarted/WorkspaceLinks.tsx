import {
  PiArrowSquareOut,
  PiFolders,
  PiGoogleChromeLogo,
  PiKey,
  PiTable,
  PiUsersThree,
  PiWebhooksLogo,
} from "react-icons/pi";
import { IconType } from "react-icons";
import Link from "next/link";
import { Box, Flex, Text } from "@radix-ui/themes";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDefinitions } from "@/services/DefinitionsContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import styles from "./WorkspaceLinks.module.scss";

export default function WorkspaceLinks() {
  const permissionsUtils = usePermissionsUtil();
  const { project } = useDefinitions();

  return (
    <>
      <StyledLink
        Icon={PiUsersThree}
        url="/settings/team"
        text="Teams & Permissions"
        disabled={!permissionsUtils.canManageTeam()}
      />
      <StyledLink
        Icon={PiGoogleChromeLogo}
        url="https://chromewebstore.google.com/detail/growthbook-devtools/opemhndcehfgipokneipaafbglcecjia"
        text="Install Chrome DevTools Extension"
        external
      />
      <StyledLink
        Icon={PiFolders}
        url="/projects"
        text="Create Projects"
        disabled={!permissionsUtils.canCreateProjects()}
      />
      <StyledLink
        Icon={PiWebhooksLogo}
        url="/settings/webhooks"
        text="Integrate Slack or Discord"
        disabled={!permissionsUtils.canCreateEventWebhook()}
      />
      <StyledLink
        Icon={PiTable}
        url="/fact-tables"
        text="Configure Metric Library"
        disabled={
          !permissionsUtils.canViewCreateFactTableModal(project) &&
          !permissionsUtils.canCreateFactMetric({
            projects: project ? [project] : [],
          })
        }
      />
      <StyledLink
        Icon={PiKey}
        url="/settings/keys"
        text="Create API Token"
        disabled={!permissionsUtils.canCreateApiKey()}
      />
    </>
  );
}

function StyledLink({
  Icon,
  url,
  text,
  external,
  disabled,
}: {
  Icon: IconType;
  url: string;
  text: string;
  disabled?: boolean;
  external?: boolean;
}) {
  const component = (
    <Link
      href={url}
      aria-disabled={disabled}
      className={styles.workspaceLink}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
    >
      <Flex align="center" height="100%">
        <Icon
          style={{
            flexShrink: 0,
            width: "20px",
            height: "20px",
            marginLeft: "var(--space-2)",
            marginRight: "var(--space-2)",
          }}
        />
        <Text size="3" weight="medium">
          {text}
          {external && (
            <PiArrowSquareOut
              style={{
                height: "15px",
                width: "15px",
                verticalAlign: "middle",
                marginLeft: "var(--space-2)",
                marginRight: "var(--space-2)",
              }}
            />
          )}
        </Text>
      </Flex>
    </Link>
  );

  return (
    <Box ml="3" mr="1" py="4" className={styles.workspaceLinkContainer}>
      {disabled ? (
        <Tooltip body="You do not have permission to complete this action">
          {component}
        </Tooltip>
      ) : (
        component
      )}
    </Box>
  );
}
