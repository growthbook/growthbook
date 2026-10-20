import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { PiWarningFill } from "react-icons/pi";
import clsx from "clsx";
import Badge from "@/ui/Badge";
import { PopoverNoticeGroup } from "@/ui/PopoverNotice";
import buttonStyles from "@/ui/Button.module.scss";
import { Popover } from "@/ui/Popover";
import Tooltip from "@/ui/Tooltip";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import listTableStyles from "@/components/Experiment/ExperimentsListTable.module.scss";
import { AppNotice } from "./notices";
import { isDismissed, useDismissedNotices } from "./headerNotices";
import NoticeListItem, { Upgrade, useNoticeAction } from "./NoticeListItem";
import styles from "./HeaderNotices.module.scss";

// PROTOTYPE (set in review): the header's warnings, as one amber badge left
// of GrowthBot: an alert icon and how many (set in review; red, and its
// list's "Needs Attention", went with expired keys, now in the banner).
// Clicking opens the list, each with its details, action and Dismiss.
// Hidden with none left.
export default function NoticeIndicator({ notices }: { notices: AppNotice[] }) {
  const dismissed = useDismissedNotices();
  const getAction = useNoticeAction();
  const [open, setOpen] = useState(false);
  // The tooltip, hidden while the list is open, and after it closes until
  // the pointer leaves the badge (set in review), so focus coming back to
  // the badge doesn't bring it straight back.
  const [tipOpen, setTipOpen] = useState(false);
  const tipHeld = useRef(false);
  const [upgrade, setUpgrade] = useState<Upgrade | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // In the persistent header, so following a link closes it.
  const router = useRouter();
  useEffect(() => {
    const close = () => setOpen(false);
    router.events.on("routeChangeStart", close);
    return () => router.events.off("routeChangeStart", close);
  }, [router.events]);

  const shown = notices.filter((n) => !isDismissed(n, dismissed));
  // The last one dismissed: the list closes with the badge.
  useEffect(() => {
    if (!shown.length) setOpen(false);
  }, [shown.length]);

  const upgradeModal = upgrade ? (
    <UpgradeModal
      close={() => setUpgrade(null)}
      source={upgrade.source}
      commercialFeature={upgrade.commercialFeature}
    />
  ) : null;
  if (!shown.length) return upgradeModal;

  const item = (notice: AppNotice, onClose?: () => void) => (
    <NoticeListItem
      key={notice.id}
      notice={notice}
      action={getAction(notice)}
      onUpgrade={(u) => {
        setOpen(false);
        setUpgrade(u);
      }}
      onDismiss={() => listRef.current?.focus()}
      onClose={onClose}
    />
  );
  const label = `${shown.length} notice${shown.length === 1 ? "" : "s"}`;

  return (
    <>
      {/* The tooltip on a wrapper, so the popover keeps the button. Short
        (set in review; was the count, "3 notices, 1 needs attention", which
        screen readers still get from the button's label), after a 400ms
        pause on hover (set in review; was instant), as GrowthBot's. */}
      <Tooltip
        content="View notices"
        delayDuration={400}
        open={tipOpen && !open}
        onOpenChange={(next) => setTipOpen(next && !tipHeld.current)}
      >
        <span
          className={styles.triggerWrap}
          onPointerLeave={() => {
            tipHeld.current = false;
          }}
        >
          <Popover
            open={open}
            onOpenChange={(next) => {
              if (next) {
                tipHeld.current = true;
                setTipOpen(false);
              }
              setOpen(next);
            }}
            side="bottom"
            align="end"
            sideOffset={8}
            showArrow={false}
            contentClassName={clsx(
              styles.list,
              listTableStyles.menuShadow,
              listTableStyles.menuOutline,
            )}
            contentStyle={{ padding: 0 }}
            trigger={
              // A plain button around @/ui/Badge (soft, medium; set in
              // review, was a custom outlined pill), so it's clickable.
              <button
                type="button"
                // The buttons' press, settling to 98% (set in review).
                className={clsx(styles.indicator, buttonStyles.pressable)}
                aria-label={label}
              >
                <Badge
                  color="amber"
                  variant="soft"
                  size="md"
                  label={
                    <>
                      <PiWarningFill size={14} aria-hidden="true" />
                      {shown.length}
                    </>
                  }
                />
              </button>
            }
            content={
              // Focus lands here when a dismissed item's button goes.
              <div ref={listRef} tabIndex={-1} className={styles.listBody}>
                <div className={styles.listItems}>
                  {shown.length === 1 ? (
                    // One notice: a band and a close button (set in review).
                    item(shown[0], () => setOpen(false))
                  ) : (
                    // More: under a "Warnings" band (set in review).
                    <PopoverNoticeGroup
                      status="warning"
                      label="Warnings"
                      count={shown.length}
                      // The close button on the band (set in review).
                      onClose={() => setOpen(false)}
                      closeLabel="Close notices"
                      icon={
                        <PiWarningFill size={18} className={styles.iconAmber} />
                      }
                    >
                      {shown.map((n) => item(n))}
                    </PopoverNoticeGroup>
                  )}
                </div>
              </div>
            }
          />
        </span>
      </Tooltip>
      {upgradeModal}
    </>
  );
}
