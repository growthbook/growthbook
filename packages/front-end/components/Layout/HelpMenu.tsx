import { useState } from "react";
import { IconButton, VisuallyHidden } from "@radix-ui/themes";
import { IconType } from "react-icons";
import {
  PiArrowSquareOutBold,
  PiBookOpen,
  PiChatCircleDots,
  PiQuestion,
  PiSlackLogo,
} from "react-icons/pi";
import Text from "@/ui/Text";
import { inferDocUrl } from "@/components/DocLink";
import { getGrowthBookBuild, isCloud } from "@/services/env";
import { useUser } from "@/services/UserContext";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import { withOpticalWeight } from "./opticalWeight";
import { useMenuTriggerTooltip } from "./SidebarTooltip";
import { buildVersion } from "./buildVersion";
import {
  MenuItemContent,
  SIDEBAR_ICON_SIZE,
  SidebarItemLook,
  SidebarItemMenu,
  SidebarMenuEntry,
  SidebarMenuInPlace,
  sidebarMenuTriggerProps,
} from "./SidebarMenu";
import styles from "./HelpMenu.module.scss";

const HelpIcon = withOpticalWeight(PiQuestion);

const SLACK_URL = "https://slack.growthbook.io/?ref=app-top-nav";

function helpLink(
  key: string,
  Icon: IconType,
  label: string,
  href: string,
): SidebarMenuEntry {
  return {
    type: "item",
    key,
    onSelect: () => {
      window.open(href, "_blank", "noopener,noreferrer");
    },
    content: (
      <MenuItemContent
        Icon={Icon}
        label={
          <>
            {label}
            <VisuallyHidden> (opens in a new tab)</VisuallyHidden>
          </>
        }
        trailing={
          <PiArrowSquareOutBold
            size={12}
            className={styles.externalIcon}
            aria-hidden="true"
          />
        }
      />
    ),
  };
}

export default function HelpMenu({
  sidebarItem,
  inPlace,
}: {
  /** Set in the sidebar; without it, it's the header's button. */
  sidebarItem?: SidebarItemLook;
  /** In the drawer, the menu is drawn in place (Sidebar.tsx). */
  inPlace?: SidebarMenuInPlace;
}) {
  const [open, setOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const { hasCommercialFeature } = useUser();
  // Plans with live chat have Pylon's own chat bubble (PylonLoader.tsx).
  const offerLiveChat = isCloud() && !hasCommercialFeature("livechat");
  const version = buildVersion(getGrowthBookBuild());

  const entries: SidebarMenuEntry[] = [
    { type: "label", key: "header", label: "Help" },
    helpLink("docs", PiBookOpen, "View docs", inferDocUrl()),
    helpLink("slack", PiSlackLogo, "Join the Slack community", SLACK_URL),
    ...(offerLiveChat
      ? [
          {
            type: "item" as const,
            key: "live-chat",
            onSelect: () => setUpgradeOpen(true),
            content: (
              <MenuItemContent
                Icon={PiChatCircleDots}
                label="Chat with support"
                trailing={
                  <PaidFeatureBadge
                    commercialFeature="livechat"
                    useTip={false}
                  />
                }
              />
            ),
          },
        ]
      : []),
    ...(version
      ? [
          { type: "separator" as const, key: "version-divider" },
          {
            type: "item" as const,
            key: "version",
            className: styles.versionItem,
            onSelect: () => {
              window.open(version.commitUrl, "_blank", "noopener,noreferrer");
            },
            content: (
              <span className={styles.versionContent}>
                <Text size="sm" truncate>
                  <span className={styles.versionText}>
                    <Text size="inherit" weight="medium">
                      Version:
                    </Text>{" "}
                    {version.label}
                    {version.date ? (
                      <span className={styles.versionDate}>
                        {" "}
                        ({version.date})
                      </span>
                    ) : null}
                    <VisuallyHidden> (opens in a new tab)</VisuallyHidden>
                  </span>
                </Text>
                <PiArrowSquareOutBold
                  size={12}
                  className={styles.externalIcon}
                  aria-hidden="true"
                />
              </span>
            ),
          },
        ]
      : []),
  ];

  const tooltip = useMenuTriggerTooltip({
    label: "Help",
    enabled: !!sidebarItem?.collapsed && !inPlace,
    menuOpen: open,
  });

  const trigger = sidebarItem ? (
    <button
      {...sidebarMenuTriggerProps({
        look: sidebarItem,
        menu: "help",
        label: "Help",
        open,
        inPlace,
        tooltip,
      })}
    >
      <HelpIcon
        size={SIDEBAR_ICON_SIZE}
        className={sidebarItem.iconClassName}
        aria-hidden
      />
      {sidebarItem.collapsed ? null : (
        <span className={sidebarItem.labelClassName}>Help</span>
      )}
      {tooltip.anchor}
    </button>
  ) : (
    <IconButton
      variant="ghost"
      color="gray"
      size="2"
      className={styles.headerButton}
      aria-label="Help"
      data-sidebar-menu-trigger="help"
    >
      <HelpIcon size={16} aria-hidden="true" />
    </IconButton>
  );

  const upgradeModal = upgradeOpen ? (
    <UpgradeModal
      close={() => setUpgradeOpen(false)}
      source="in-app-help"
      commercialFeature="livechat"
    />
  ) : null;

  return (
    <>
      {upgradeModal}
      <SidebarItemMenu
        trigger={trigger}
        heading="Help"
        entries={entries}
        inPlace={inPlace}
        open={open}
        onOpenChange={setOpen}
        placement="end"
        inSidebar={!!sidebarItem}
      />
    </>
  );
}
