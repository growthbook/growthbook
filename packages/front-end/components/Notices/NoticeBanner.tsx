import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import clsx from "clsx";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiInfoBold, PiWarningFill, PiXBold } from "react-icons/pi";
import Tooltip from "@/ui/Tooltip";
import Badge from "@/ui/Badge";
import buttonStyles from "@/ui/Button.module.scss";
import Callout from "@/ui/Callout";
import { Popover } from "@/ui/Popover";
import { PopoverNoticeGroup } from "@/ui/PopoverNotice";
import listTableStyles from "@/components/Experiment/ExperimentsListTable.module.scss";
import Link from "@/ui/Link";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import { AppNotice } from "./notices";
import NoticeListItem, { Upgrade, useNoticeAction } from "./NoticeListItem";
import { asSentence } from "./headerNotices";
import styles from "./HeaderNotices.module.scss";
import stackStyles from "./NoticeStack.module.scss";

// PROTOTYPE (set in review): the header's errors, as an error Callout
// (its usual size; set in review, tried small),
// full bleed, above the header: from the side nav to the window's right
// edge (or the docked GrowthBot rail's), which both stay full height (set
// in review; it was the window's full width). The header and page move
// down by its height (--notice-banner-height, on <html>), so it covers
// nothing. One at a time: the error with the highest precedence
// (headerNotices.ts; set in review, tried a pager through them all), with
// its action for people who can take it, and with others, "+N more" after
// it (set in review), opening them in a list, as the header badge's
// (PopoverNoticeGroup). Not dismissible: it goes when the condition is
// resolved, and the next error by precedence takes its place.
// onDismiss (set in review): a close button, for people who can't act on
// its error, when it's the only one (headerNotices.ts).
export default function NoticeBanner({
  notice,
  more = [],
  onDismiss,
}: {
  notice: AppNotice | null;
  more?: AppNotice[];
  onDismiss?: () => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  // In the persistent header, so following a link closes it; and closed
  // once the others are resolved.
  const router = useRouter();
  useEffect(() => {
    const close = () => setMoreOpen(false);
    router.events.on("routeChangeStart", close);
    return () => router.events.off("routeChangeStart", close);
  }, [router.events]);
  useEffect(() => {
    if (!more.length) setMoreOpen(false);
  }, [more.length]);
  const getAction = useNoticeAction();
  const [upgrade, setUpgrade] = useState<Upgrade | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const shown = notice !== null;
  // Its height on <html>, for everything below it to move down by; it can
  // wrap to two lines in a narrow window.
  useLayoutEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!shown || !el) return;
    const update = () =>
      root.style.setProperty(
        "--notice-banner-height",
        `${el.getBoundingClientRect().height}px`,
      );
    update();
    const observer = new ResizeObserver(update);
    // Its whole box, padding too (fix, set in review: a change to its
    // padding alone wasn't seen, so the header stayed where it was).
    observer.observe(el, { box: "border-box" });
    return () => {
      observer.disconnect();
      root.style.removeProperty("--notice-banner-height");
    };
  }, [shown]);

  if (!notice) return null;
  const action = getAction(notice);

  return (
    <>
      {/* @/ui/Callout, full bleed: square, the banner's width. */}
      <div ref={ref} className={styles.banner}>
        <Callout
          status="error"
          // Its content inset as the page's (the page frame's 32px sides,
          // global.scss), so it lines up with the title (set in review).
          style={{
            borderRadius: 0,
            // Dark text, not the Callout's red (or violet): the Hypothesis
            // field's typed text, --gray-12 (set in review; tried
            // --color-text-high). Its icon keeps the Callout's colour
            // (HeaderNotices.module.scss).
            color: "var(--gray-12)",
            // 44px tall on one line (set in review; tried 46px, and the
            // Callout's own 16px padding made it 52px): 12px above the 20px
            // line, and 11px below it plus the line under it.
            paddingTop: 12,
            paddingBottom: 11,
            // A 1px line under it, the side nav's divider colour
            // (HeaderNotices.module.scss; set in review). It's the
            // banner's, so it's only there with the banner.
            borderBottom: "1px solid var(--notice-banner-line)",
            paddingLeft: "var(--space-6)",
            paddingRight: "var(--space-6)",
            // 8px from the icon to the text (set in review; the Callout's
            // own is 12px at this size).
            columnGap: "var(--space-2)",
          }}
          action={
            action || onDismiss ? (
              <Flex align="center" gap="3">
                {action ? (
                  // A link (@/ui/Link; set in review; tried solid, then
                  // ghost buttons): to its page, or opening the upgrade flow.
                  <Link
                    color="red"
                    // 500 (set in review; tried 600).
                    weight="medium"
                    {...(action.kind === "link"
                      ? { href: action.href }
                      : { onClick: () => setUpgrade(action.upgrade) })}
                  >
                    {action.label}
                  </Link>
                ) : null}
                {onDismiss ? (
                  // Quiet: a grey ghost ×, as the popovers' close.
                  <IconButton
                    variant="ghost"
                    color="gray"
                    size="1"
                    onClick={onDismiss}
                    aria-label="Dismiss"
                    style={{ margin: 0, color: "var(--gray-11)" }}
                  >
                    <PiXBold size={14} />
                  </IconButton>
                ) : null}
              </Flex>
            ) : undefined
          }
        >
          {/* The title at 400, as the rest (set in review; was bold). */}
          {/* As sentences: a leading capital and a full stop (set in
            review; headerNotices.ts's asSentence). */}
          {asSentence(notice.title)}
          {/* Its details, as the current product's pill showed them on
            hover (NoticeStack.tsx), behind an info icon (set in review;
            were inline, plain-text ones only). */}
          {notice.details ? (
            <Tooltip
              content={
                <Box className={stackStyles["notice-tooltip"]}>
                  {typeof notice.details === "string"
                    ? asSentence(notice.details)
                    : notice.details}
                </Box>
              }
              delayDuration={200}
            >
              <button
                type="button"
                className={styles.bannerInfo}
                aria-label={`About: ${notice.title}`}
              >
                <PiInfoBold size={14} aria-hidden="true" />
              </button>
            </Tooltip>
          ) : null}
          {/* The others (set in review; was a "+N more" link beside the
            action): a chip with how many, right after the text, opening
            them in a list. */}
          {more.length ? (
            <>
              <Popover
                open={moreOpen}
                onOpenChange={setMoreOpen}
                side="bottom"
                align="start"
                sideOffset={8}
                showArrow={false}
                contentClassName={clsx(
                  styles.list,
                  listTableStyles.menuShadow,
                  listTableStyles.menuOutline,
                )}
                contentStyle={{ padding: 0 }}
                trigger={
                  <button
                    type="button"
                    className={clsx(styles.bannerMore, buttonStyles.pressable)}
                    aria-label={`${more.length} more issue${more.length === 1 ? "" : "s"}`}
                  >
                    <Badge
                      color="red"
                      variant="soft"
                      size="sm"
                      label={`+${more.length}`}
                    />
                  </button>
                }
                content={
                  <div className={styles.listBody}>
                    <div className={styles.listItems}>
                      <PopoverNoticeGroup
                        status="error"
                        label="Needs Attention"
                        count={more.length}
                        icon={
                          <PiWarningFill size={18} className={styles.iconRed} />
                        }
                        onClose={() => setMoreOpen(false)}
                        closeLabel="Close issues"
                      >
                        {more.map((n) => (
                          <NoticeListItem
                            key={n.id}
                            notice={n}
                            action={getAction(n)}
                            onUpgrade={(u) => {
                              setMoreOpen(false);
                              setUpgrade(u);
                            }}
                          />
                        ))}
                      </PopoverNoticeGroup>
                    </div>
                  </div>
                }
              />
            </>
          ) : null}
        </Callout>
      </div>
      {upgrade ? (
        <UpgradeModal
          close={() => setUpgrade(null)}
          source={upgrade.source}
          commercialFeature={upgrade.commercialFeature}
        />
      ) : null}
    </>
  );
}
