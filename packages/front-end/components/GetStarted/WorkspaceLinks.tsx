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
import { Box, Flex } from "@radix-ui/themes";
import { useMemo } from "react";
import { FaFirefoxBrowser } from "react-icons/fa";
import Text from "@/ui/Text";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDefinitions } from "@/services/DefinitionsContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import {
  CHROME_EXTENSION_LINK,
  FIREFOX_EXTENSION_LINK,
  getBrowserDevice,
} from "@/components/OpenVisualEditorLink";
import styles from "./WorkspaceLinks.module.scss";

export default function WorkspaceLinks() {
  const permissionsUtils = usePermissionsUtil();
  const { project } = useDefinitions();

  const { browser } = useMemo(() => {
    const ua = navigator.userAgent;
    return getBrowserDevice(ua);
  }, []);

  return (
    <>
      <StyledLink
        Icon={PiUsersThree}
        url="/settings/team"
        text="Teams & Permissions"
        disabled={!permissionsUtils.canManageTeam()}
      />
      {browser === "firefox" ? (
        <StyledLink
          Icon={FaFirefoxBrowser}
          url={FIREFOX_EXTENSION_LINK}
          text="Install Firefox DevTools Extension"
          external
        />
      ) : (
        <StyledLink
          Icon={PiGoogleChromeLogo}
          url={CHROME_EXTENSION_LINK}
          text="Install Chrome DevTools Extension"
          external
        />
      )}
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
        <Text size="large" weight="medium">
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
