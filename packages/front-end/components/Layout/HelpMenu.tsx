import { ReactNode, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { IconType } from "react-icons";
import {
  PiArrowSquareOutBold,
  PiBookOpen,
  PiCheck,
  PiCopy,
  PiQuestion,
  PiSlackLogo,
} from "react-icons/pi";
import { DropdownMenu } from "@/ui/DropdownMenu";
import { inferDocUrl } from "@/components/DocLink";
import { getGrowthBookBuild, isPrototype } from "@/services/env";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { useGrowthBotPrototype } from "@/components/Agent/prototypeGrowthBotState";
import listTableStyles from "@/components/Experiment/ExperimentsListTable.module.scss";
import { withOpticalWeight } from "./opticalWeight";
import { BOTTOM_TOOLTIP_DELAY_MS } from "./railTooltips";
import railTooltipStyles from "./AppRail.module.scss";
import styles from "./ProfileMenu.module.scss";
import helpStyles from "./HelpMenu.module.scss";
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

// The GrowthBook build, as main's sidebar showed it at its foot (set in
// review; it moved here): the last version and the commit, e.g.
// "4.2.0+bd13c78". Only self-hosted builds have it.
// PROTOTYPE (set in review): without it (as locally), the prototype's
// Hosting setting (GrowthBot's, prototypeGrowthBotState.ts) set to
// Self-hosted shows a made-up one, so the row can be seen.
function useBuild(): { version: string } | null {
  const { hosting } = useGrowthBotPrototype();
  const build = getGrowthBookBuild();
  if (build.sha) {
    return {
      version: `${build.lastVersion}+${build.sha.substring(0, 7)}`,
    };
  }
  if (isPrototype() && hosting === "self-hosted") {
    return {
      version: `${build.lastVersion || "4.2.0"}+bd13c78`,
    };
  }
  return null;
}

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
  const build = useBuild();
  const { performCopy, copySuccess } = useCopyToClipboard({ timeout: 1500 });
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
    helpLinkEntry("slack", PiSlackLogo, "Join Slack Community", SLACK_URL),
    // The version, below a divider (set in review): "Version: 4.2.0+…" as
    // one line, lined up with the items' labels, quieter than the links.
    // Choosing it copies the version and shows "Copied" in its place for a
    // moment, said to screen readers too; the menu stays open. A copy icon
    // at the right on hover and focus. (No tooltip: the build date was in
    // one, set in review, then removed.)
    ...(build
      ? [
          { type: "separator" as const, key: "version-divider" },
          {
            type: "item" as const,
            key: "version",
            className: clsx(styles.item, helpStyles.versionItem),
            keepOpen: true,
            onSelect: () => performCopy(build.version),
            content: (
              <span className={helpStyles.versionContent}>
                <span className="sr-only">Copy </span>
                {/* One line of text, "Version: 4.2.0+bd13c78" (set in
                  review; was the label left and the number right), the
                  copy icon at the row's right on hover and focus. */}
                <span className={helpStyles.versionText}>
                  <span className={helpStyles.versionLabel}>Version:</span>{" "}
                  {copySuccess ? "Copied" : build.version}
                </span>
                {/* A check in the copy icon's place while it says "Copied"
                  (set in review). */}
                {copySuccess ? (
                  <PiCheck
                    size={14}
                    className={helpStyles.copyIcon}
                    aria-hidden="true"
                  />
                ) : (
                  <PiCopy
                    size={14}
                    className={helpStyles.copyIcon}
                    aria-hidden="true"
                  />
                )}
                <span className="sr-only" role="status">
                  {copySuccess ? "Version copied" : ""}
                </span>
              </span>
            ),
          },
        ]
      : []),
  ];

  const trigger = (onClick?: (fromKeyboard: boolean) => void): ReactNode => (
    <button
      type="button"
      className={clsx(
        triggerClassName,
        (open || inPlace?.open) && openClassName,
      )}
      aria-label="Help"
      data-rail-menu-trigger="help"
      {...(onClick
        ? {
            "aria-expanded": !!inPlace?.open,
            onClick: (e: React.MouseEvent) => onClick(e.detail === 0),
          }
        : {})}
    >
      <HelpIcon size={iconSize} className={iconClassName} aria-hidden="true" />
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
