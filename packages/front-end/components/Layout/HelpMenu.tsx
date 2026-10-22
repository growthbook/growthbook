import { ReactNode, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { IconButton, VisuallyHidden } from "@radix-ui/themes";
import { IconType } from "react-icons";
import {
  PiArrowSquareOutBold,
  PiBookOpen,
  PiChatCircleDots,
  PiCheck,
  PiCopy,
  PiQuestion,
  PiSlackLogo,
} from "react-icons/pi";
import { Popover } from "@/ui/Popover";
import Text from "@/ui/Text";
import { inferDocUrl } from "@/components/DocLink";
import { getGrowthBookBuild, isCloud } from "@/services/env";
import { useUser } from "@/services/UserContext";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { withOpticalWeight } from "./opticalWeight";
import { useMenuTriggerTooltip } from "./railTooltips";
import { buildVersionLabel } from "./buildVersion";
import {
  InPlaceMenu,
  MenuItemContent,
  RailMenuEntry,
  RailMenuInPlace,
} from "./railMenu";
import railStyles from "./AppRail.module.scss";
import railMenuStyles from "./RailMenu.module.scss";
import styles from "./HelpMenu.module.scss";

const HelpIcon = withOpticalWeight(PiQuestion);

const SLACK_URL = "https://slack.growthbook.io/?ref=app-top-nav";

const externalIcon = (
  <PiArrowSquareOutBold
    size={12}
    className={styles.externalIcon}
    aria-hidden="true"
  />
);
const newTab = <VisuallyHidden> (opens in a new tab)</VisuallyHidden>;

type HelpItem = {
  key: string;
  Icon: IconType;
  label: string;
  trailing?: ReactNode;
  srSuffix?: ReactNode;
  // Right after the label (8px), not at the row's end.
  trailingAfterLabel?: boolean;
  onSelect: () => void;
};

function helpLink(
  key: string,
  Icon: IconType,
  label: string,
  href: string,
): HelpItem {
  return {
    key,
    Icon,
    label,
    trailing: externalIcon,
    srSuffix: newTab,
    onSelect: () => {
      window.open(href, "_blank", "noopener,noreferrer");
    },
  };
}

// Chat with support opens the upgrade window, as the old floating help
// panel's Upgrade Now did.
export default function HelpMenu({
  collapsed = false,
  iconSize = 16,
  triggerClassName,
  openClassName,
  iconClassName,
  labelClassName,
  inPlace,
}: {
  // Without these, the header's Help (pages without the side nav).
  collapsed?: boolean;
  iconSize?: number;
  triggerClassName?: string;
  openClassName?: string;
  iconClassName?: string;
  labelClassName?: string;
  // In the narrow drawer: its menu drawn in place (AppRail.tsx).
  inPlace?: RailMenuInPlace;
}) {
  const inRail = triggerClassName !== undefined;
  const [open, setOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const { hasCommercialFeature } = useUser();
  // Plans with live chat have Pylon's own chat bubble (InAppHelp.tsx).
  const offerLiveChat = isCloud() && !hasCommercialFeature("livechat");
  const version = buildVersionLabel(getGrowthBookBuild());
  const { performCopy, copySuccess } = useCopyToClipboard({ timeout: 1500 });

  const items: HelpItem[] = [
    helpLink("docs", PiBookOpen, "View Docs", inferDocUrl()),
    helpLink("slack", PiSlackLogo, "Join Slack Community", SLACK_URL),
    ...(offerLiveChat
      ? [
          {
            key: "live-chat",
            Icon: PiChatCircleDots,
            label: "Chat with support",
            trailing: (
              <PaidFeatureBadge commercialFeature="livechat" useTip={false} />
            ),
            trailingAfterLabel: true,
            onSelect: () => {
              setOpen(false);
              setUpgradeOpen(true);
            },
          },
        ]
      : []),
  ];

  // The menu stays open, to show "Copied".
  const copyVersion = () => {
    if (version) performCopy(version);
  };
  const versionContent = (
    <span className={styles.versionContent}>
      <VisuallyHidden>Copy </VisuallyHidden>
      <Text size="sm" truncate>
        <span className={styles.versionText}>
          <Text size="inherit" weight="medium">
            Version:
          </Text>{" "}
          {copySuccess ? "Copied" : version}
        </span>
      </Text>
      {copySuccess ? (
        <PiCheck size={14} className={styles.copyIcon} aria-hidden="true" />
      ) : (
        <PiCopy size={14} className={styles.copyIcon} aria-hidden="true" />
      )}
      <VisuallyHidden role="status">
        {copySuccess ? "Version copied" : ""}
      </VisuallyHidden>
    </span>
  );

  const entries: RailMenuEntry[] = [
    { type: "label", key: "header", label: "Help" },
    ...items.map(
      (item): RailMenuEntry => ({
        type: "item",
        key: item.key,
        onSelect: item.onSelect,
        content: (
          <MenuItemContent
            Icon={item.Icon}
            label={
              <>
                {item.label}
                {item.srSuffix}
              </>
            }
            trailing={item.trailing}
          />
        ),
      }),
    ),
    ...(version
      ? [
          { type: "separator" as const, key: "version-divider" },
          {
            type: "item" as const,
            key: "version",
            className: styles.versionItem,
            keepOpen: true,
            onSelect: copyVersion,
            content: versionContent,
          },
        ]
      : []),
  ];

  // Opened with a click, focus stays put, as the section menus.
  const openedByPointer = useRef(false);

  const tooltip = useMenuTriggerTooltip({
    label: "Help",
    enabled: collapsed && !inPlace,
    menuOpen: open,
  });

  const trigger = inRail ? (
    <button
      type="button"
      className={clsx(
        triggerClassName,
        (open || inPlace?.open) && openClassName,
      )}
      aria-label="Help"
      data-rail-menu-trigger="help"
      onPointerDown={() => {
        openedByPointer.current = true;
      }}
      onKeyDown={() => {
        openedByPointer.current = false;
      }}
      {...tooltip.triggerProps}
      {...(inPlace
        ? {
            "aria-expanded": inPlace.open,
            onClick: (e: React.MouseEvent) => inPlace.onOpen(e.detail === 0),
          }
        : {})}
    >
      <HelpIcon size={iconSize} className={iconClassName} aria-hidden />
      {collapsed ? null : <span className={labelClassName}>Help</span>}
      {tooltip.anchor}
    </button>
  ) : (
    <IconButton
      variant="ghost"
      color="gray"
      size="2"
      className={styles.headerButton}
      aria-label="Help"
      data-rail-menu-trigger="help"
      onPointerDown={() => {
        openedByPointer.current = true;
      }}
      onKeyDown={() => {
        openedByPointer.current = false;
      }}
    >
      <HelpIcon size={iconSize} aria-hidden="true" />
    </IconButton>
  );

  const upgradeModal = upgradeOpen ? (
    <UpgradeModal
      close={() => setUpgradeOpen(false)}
      source="in-app-help"
      commercialFeature="livechat"
    />
  ) : null;

  if (inPlace) {
    return (
      <>
        {upgradeModal}
        {trigger}
        {inPlace.open && inPlace.host
          ? createPortal(
              <InPlaceMenu label="Help" entries={entries} inPlace={inPlace} />,
              inPlace.host,
            )
          : null}
      </>
    );
  }

  const popoverRow = (
    key: string,
    content: ReactNode,
    onSelect: () => void,
    className?: string,
  ) => (
    <button
      key={key}
      type="button"
      className={clsx(railStyles.popoverItem, styles.popoverRow, className)}
      onClick={onSelect}
    >
      {content}
    </button>
  );

  return (
    <>
      {upgradeModal}
      <Popover
        open={open}
        onOpenChange={setOpen}
        trigger={trigger}
        // In the side nav, clear of its edge (the item sits 8px inside it).
        side={inRail ? "right" : "bottom"}
        align="end"
        sideOffset={inRail ? 16 : 8}
        showArrow={false}
        contentClassName={clsx(railStyles.popover, styles.popover)}
        // The padding is on the list inside (.popoverBody), as the section
        // menus'.
        contentStyle={{ padding: 0 }}
        onOpenAutoFocus={(e) => {
          if (openedByPointer.current) e.preventDefault();
        }}
        onCloseAutoFocus={(e) => {
          if (openedByPointer.current) e.preventDefault();
        }}
        content={
          <div
            className={clsx(railStyles.popoverBody, railStyles.popoverInner)}
            role="group"
            aria-label="Help"
          >
            <div className={railStyles.eyebrow} aria-hidden="true">
              Help
            </div>
            {items.map((item) =>
              popoverRow(
                item.key,
                <>
                  <item.Icon
                    size={16}
                    className={styles.popoverIcon}
                    aria-hidden="true"
                  />
                  <span
                    className={clsx(
                      styles.popoverLabel,
                      item.trailingAfterLabel && styles.popoverLabelFit,
                    )}
                  >
                    {item.label}
                    {item.srSuffix}
                  </span>
                  {item.trailing}
                </>,
                item.onSelect,
              ),
            )}
            {version ? (
              <>
                <div
                  className={clsx(
                    railMenuStyles.separator,
                    styles.popoverDivider,
                  )}
                  role="none"
                />
                {popoverRow(
                  "version",
                  versionContent,
                  copyVersion,
                  clsx(styles.versionItem, styles.popoverVersion),
                )}
              </>
            ) : null}
          </div>
        }
      />
    </>
  );
}
