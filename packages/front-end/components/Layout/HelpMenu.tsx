import { ReactNode, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { IconType } from "react-icons";
import {
  PiArrowSquareOutBold,
  PiBookOpen,
  PiChatTeardropDots,
  PiQuestion,
  PiSlackLogo,
} from "react-icons/pi";
import { DropdownMenu } from "@/ui/DropdownMenu";
import { inferDocUrl } from "@/components/DocLink";
import listTableStyles from "@/components/Experiment/ExperimentsListTable.module.scss";
import { withOpticalWeight } from "./opticalWeight";
import { BOTTOM_TOOLTIP_DELAY_MS } from "./railTooltips";
import railTooltipStyles from "./AppRail.module.scss";
import styles from "./ProfileMenu.module.scss";
import helpStyles from "./HelpMenu.module.scss";
import { usePrototypeLiveChatInHelp } from "./PrototypeControls";
import { openMockLiveChat, useMockLiveChat } from "./liveChatMockState";
import {
  DropdownEntries,
  InPlaceMenu,
  RailMenuEntry,
  RailMenuInPlace,
} from "./railMenu";

// The question mark, thickened (opticalWeight.tsx; set in review).
const HelpIcon = withOpticalWeight(PiQuestion);

// The in-app help's Slack link (components/Auth/InAppHelp.tsx).
const SLACK_URL = "https://slack.growthbook.io/?ref=app-top-nav";

// A link out: opens in a new tab, marked by the arrow-out icon (and said
// to screen readers).
function helpLinkEntry(
  key: string,
  Icon: IconType,
  label: string,
  href: string,
): RailMenuEntry {
  return {
    type: "item",
    key,
    onSelect: () => {
      window.open(href, "_blank", "noopener,noreferrer");
    },
    content: (
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
    ),
  };
}

// Help in the side nav (set in review; was a link straight to the docs):
// a menu, as the side nav's section menus (the profile menu's styles), with
// View Docs, (prototype) Chat with Support and Join Slack Community. Docs
// and Slack open in a new tab, marked by the arrow-out icon (and said to
// screen readers). It opens to the right of the rail. In the narrow drawer
// (inPlace; set in review), the same items open in place of the nav
// instead (railMenu.tsx).
export default function HelpMenu({
  collapsed,
  iconSize,
  triggerClassName,
  openClassName,
  iconClassName,
  labelClassName,
  inPlace,
}: {
  collapsed: boolean;
  iconSize: number;
  // The rail's item styles.
  triggerClassName: string;
  openClassName: string;
  iconClassName?: string;
  labelClassName: string;
  // Opt-in: in the narrow drawer, its menu drawn in place (AppRail.tsx).
  inPlace?: RailMenuInPlace;
}) {
  const [open, setOpen] = useState(false);
  // PROTOTYPE (set in review): with "Live chat in Help menu" on, a Chat
  // with Support item after View Docs (set in review; was first), opening the mock live chat (MockLiveChat.tsx),
  // with a red dot while there's an unread message, and the same dot on
  // Help's icon in the rail, until the chat's opened.
  const liveChat = usePrototypeLiveChatInHelp();
  const { unread } = useMockLiveChat();
  const unreadShown = liveChat ? unread : 0;
  // A dot, not a count (set in review; was the number in a red pill): the
  // same 8px red dot on the icon, expanded or collapsed, and at the end of
  // the menu item. Screen readers hear there's something new, not how many.
  const unreadLabel = "new message";
  const entries: RailMenuEntry[] = [
    {
      // A header, as the section menus' (set in review).
      type: "node",
      key: "header",
      node: (
        <div className={styles.eyebrow} aria-hidden="true">
          Help
        </div>
      ),
    },
    helpLinkEntry("docs", PiBookOpen, "View Docs", inferDocUrl()),
    ...(liveChat
      ? [
          {
            type: "item" as const,
            key: "chat",
            onSelect: openMockLiveChat,
            content: (
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
                  <span className={helpStyles.itemDot} aria-hidden="true" />
                ) : null}
              </span>
            ),
          },
        ]
      : []),
    helpLinkEntry("slack", PiSlackLogo, "Join Slack Community", SLACK_URL),
  ];

  const trigger = (onClick?: (fromKeyboard: boolean) => void): ReactNode => (
    <button
      type="button"
      className={clsx(
        triggerClassName,
        (open || inPlace?.open) && openClassName,
      )}
      aria-label={unreadShown ? `Help, ${unreadLabel}` : "Help"}
      data-rail-menu-trigger="help"
      {...(onClick
        ? {
            "aria-expanded": !!inPlace?.open,
            onClick: (e: React.MouseEvent) => onClick(e.detail === 0),
          }
        : {})}
    >
      <span className={helpStyles.iconWrap}>
        <HelpIcon
          size={iconSize}
          className={iconClassName}
          aria-hidden="true"
        />
        {unreadShown ? (
          <span className={helpStyles.dot} aria-hidden="true" />
        ) : null}
      </span>
      {collapsed ? null : <span className={labelClassName}>Help</span>}
    </button>
  );

  if (inPlace) {
    return (
      <>
        {trigger(inPlace.onOpen)}
        {inPlace.open && inPlace.host
          ? createPortal(
              <InPlaceMenu
                label="Help"
                entries={entries}
                itemClassName={styles.item}
                inPlace={inPlace}
              />,
              inPlace.host,
            )
          : null}
      </>
    );
  }

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
      trigger={trigger()}
    >
      <DropdownEntries entries={entries} itemClassName={styles.item} />
    </DropdownMenu>
  );
}
