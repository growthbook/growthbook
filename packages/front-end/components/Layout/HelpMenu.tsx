import { useState } from "react";
import clsx from "clsx";
import { IconType } from "react-icons";
import {
  PiArrowSquareOutBold,
  PiBookOpen,
  PiChatTeardropDots,
  PiQuestion,
  PiSlackLogo,
} from "react-icons/pi";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import { inferDocUrl } from "@/components/DocLink";
import listTableStyles from "@/components/Experiment/ExperimentsListTable.module.scss";
import { withOpticalWeight } from "./opticalWeight";
import { BOTTOM_TOOLTIP_DELAY_MS } from "./railTooltips";
import railTooltipStyles from "./AppRail.module.scss";
import styles from "./ProfileMenu.module.scss";
import helpStyles from "./HelpMenu.module.scss";
import { usePrototypeLiveChatInHelp } from "./PrototypeControls";
import { openMockLiveChat, useMockLiveChat } from "./liveChatMockState";

// The question mark, thickened (opticalWeight.tsx; set in review).
const HelpIcon = withOpticalWeight(PiQuestion);

// The in-app help's Slack link (components/Auth/InAppHelp.tsx).
const SLACK_URL = "https://slack.growthbook.io/?ref=app-top-nav";

function HelpItem({
  Icon,
  label,
  href,
}: {
  Icon: IconType;
  label: string;
  href: string;
}) {
  return (
    <DropdownMenuItem
      className={styles.item}
      onClick={() => {
        window.open(href, "_blank", "noopener,noreferrer");
      }}
    >
      <span className={styles.itemContent}>
        <Icon size={18} className={styles.itemIcon} aria-hidden="true" />
        <span className={styles.itemLabel}>
          {label}
          <span className="sr-only"> (opens in a new tab)</span>
        </span>
        {/* Opens in a new tab: bold, in --slate-9 (set in review). */}
        <PiArrowSquareOutBold
          size={13}
          className={styles.externalIcon}
          aria-hidden="true"
        />
      </span>
    </DropdownMenuItem>
  );
}

// Help in the side nav (set in review; was a link straight to the docs):
// a menu, as the side nav's section menus (the profile menu's styles), with
// View Docs, (prototype) Chat with Support and Join Slack Community. Docs
// and Slack open in a new tab, marked by the arrow-out icon (and said to
// screen readers). It opens to the right of the rail.
export default function HelpMenu({
  collapsed,
  iconSize,
  triggerClassName,
  openClassName,
  iconClassName,
  labelClassName,
}: {
  collapsed: boolean;
  iconSize: number;
  // The rail's item styles.
  triggerClassName: string;
  openClassName: string;
  iconClassName?: string;
  labelClassName: string;
}) {
  const [open, setOpen] = useState(false);
  // PROTOTYPE (set in review): with "Live chat in Help menu" on, a Chat
  // with Support item after View Docs (set in review; was first), opening the mock live chat (MockLiveChat.tsx),
  // with its unread count; and on Help in the rail, a red count beside the
  // label, or a red dot on the icon when collapsed, until the chat's opened.
  const liveChat = usePrototypeLiveChatInHelp();
  const { unread } = useMockLiveChat();
  const unreadShown = liveChat ? unread : 0;
  const unreadLabel = `${unreadShown} unread message${unreadShown === 1 ? "" : "s"}`;
  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
      menuPlacement="end"
      menuSide="right"
      // 8px past the rail's edge, as its section menus (set in review).
      menuSideOffset={16}
      // Collapsed, its name on hover, as the rail's other icons (set in
      // review).
      triggerTooltip={collapsed ? "Help" : undefined}
      triggerTooltipSide="right"
      triggerTooltipDelay={BOTTOM_TOOLTIP_DELAY_MS}
      triggerTooltipClassName={railTooltipStyles.railTooltip}
      contentClassName={clsx(
        styles.menu,
        styles.helpMenu,
        listTableStyles.menuShadow,
        listTableStyles.menuOutline,
      )}
      trigger={
        <button
          type="button"
          className={clsx(triggerClassName, open && openClassName)}
          aria-label={unreadShown ? `Help, ${unreadLabel}` : "Help"}
        >
          <span className={helpStyles.iconWrap}>
            <HelpIcon
              size={iconSize}
              className={iconClassName}
              aria-hidden="true"
            />
            {collapsed && unreadShown ? (
              <span className={helpStyles.dot} aria-hidden="true" />
            ) : null}
          </span>
          {collapsed ? null : <span className={labelClassName}>Help</span>}
          {!collapsed && unreadShown ? (
            <span className={styles.countBadge} aria-hidden="true">
              {unreadShown}
            </span>
          ) : null}
        </button>
      }
    >
      {/* A header, as the section menus' (set in review). */}
      <div className={styles.eyebrow} aria-hidden="true">
        Help
      </div>
      <HelpItem Icon={PiBookOpen} label="View Docs" href={inferDocUrl()} />
      {liveChat ? (
        <DropdownMenuItem className={styles.item} onClick={openMockLiveChat}>
          <span className={styles.itemContent}>
            <PiChatTeardropDots
              size={18}
              className={styles.itemIcon}
              aria-hidden="true"
            />
            <span className={styles.itemLabel}>
              Chat with Support
              {unreadShown ? (
                <span className="sr-only">, {unreadLabel}</span>
              ) : null}
            </span>
            {unreadShown ? (
              <span className={styles.countBadge} aria-hidden="true">
                {unreadShown}
              </span>
            ) : null}
          </span>
        </DropdownMenuItem>
      ) : null}
      <HelpItem
        Icon={PiSlackLogo}
        label="Join Slack Community"
        href={SLACK_URL}
      />
    </DropdownMenu>
  );
}
