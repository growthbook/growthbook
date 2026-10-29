import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex } from "@radix-ui/themes";
import { PiWarningFill } from "react-icons/pi";
import clsx from "clsx";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import { Popover } from "@/ui/Popover";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import { NARROW_LAYOUT_BREAKPOINT_PX } from "@/components/Layout/constants";
import useMediaQuery from "@/hooks/useMediaQuery";
import { AppNotice, rankNotices } from "./notices";
import styles from "./NoticeStack.module.scss";

type Upgrade = NonNullable<AppNotice["upgrade"]>;

// The most important notice in full, and a "+N" that lists them all, so a
// crowded row stays one line.
export default function NoticeStack({ notices }: { notices: AppNotice[] }) {
  const [upgrade, setUpgrade] = useState<Upgrade | null>(null);
  const [listOpen, setListOpen] = useState(false);
  // Narrow headers share their first row with the menu and GrowthBot
  // (TopNav.module.scss), so the notices collapse to one button.
  const compact = useMediaQuery(
    `(max-width: ${NARROW_LAYOUT_BREAKPOINT_PX}px)`,
  );
  // The list lives in the persistent top nav, so following a link closes it.
  const router = useRouter();
  useEffect(() => {
    const close = () => setListOpen(false);
    router.events.on("routeChangeStart", close);
    return () => router.events.off("routeChangeStart", close);
  }, [router.events]);
  if (!notices.length) return null;
  const ranked = rankNotices(notices);
  const [top, ...rest] = ranked;

  const list = (
    <Flex direction="column" gap="2">
      {ranked.map((notice) => (
        <NoticeCallout key={notice.id} notice={notice} onUpgrade={setUpgrade} />
      ))}
    </Flex>
  );
  const upgradeModal = upgrade ? (
    <UpgradeModal
      close={() => setUpgrade(null)}
      source={upgrade.source}
      commercialFeature={upgrade.commercialFeature}
    />
  ) : null;

  // Even with one notice, so a tap shows its full text.
  if (compact) {
    return (
      <Flex align="center" flexShrink="0">
        <Popover
          open={listOpen}
          onOpenChange={setListOpen}
          side="bottom"
          align="end"
          contentStyle={{ maxWidth: 380 }}
          onOpenAutoFocus={(e) => e.preventDefault()}
          trigger={
            <Button
              variant="soft"
              color="gray"
              size="sm"
              className={styles.more}
              aria-label={
                ranked.length === 1 ? "1 notice" : `${ranked.length} notices`
              }
            >
              <PiWarningFill
                size={15}
                color={
                  top.severity === "error" ? "var(--red-11)" : "var(--amber-11)"
                }
              />
              {ranked.length}
            </Button>
          }
          content={list}
        />
        {upgradeModal}
      </Flex>
    );
  }

  return (
    <Flex align="center" gap="2" flexShrink="0">
      <Tooltip
        content={<Box className={styles["notice-tooltip"]}>{top.details}</Box>}
        enabled={!!top.details}
      >
        <Flex display="inline-flex">
          <NoticePill notice={top} onUpgrade={setUpgrade} />
        </Flex>
      </Tooltip>
      {rest.length ? (
        <Popover
          open={listOpen}
          onOpenChange={setListOpen}
          side="bottom"
          align="end"
          contentStyle={{ maxWidth: 380 }}
          onOpenAutoFocus={(e) => e.preventDefault()}
          trigger={
            <Button
              variant="soft"
              color="gray"
              size="sm"
              className={styles.more}
              aria-label={`${rest.length} more notices`}
            >
              +{rest.length}
            </Button>
          }
          content={list}
        />
      ) : null}
      {upgradeModal}
    </Flex>
  );
}

function noticeLink(notice: AppNotice, onUpgrade: (upgrade: Upgrade) => void) {
  const { href, upgrade } = notice;
  if (href) return { href };
  if (upgrade) return { onClick: () => onUpgrade(upgrade) };
  return null;
}

function NoticePill({
  notice,
  onUpgrade,
}: {
  notice: AppNotice;
  onUpgrade: (upgrade: Upgrade) => void;
}) {
  const className = clsx(
    styles.pill,
    styles[`${notice.severity}-notification`],
  );
  const link = noticeLink(notice, onUpgrade);
  const content = (
    <>
      <PiWarningFill size={15} />
      {notice.title}
    </>
  );
  return link ? (
    <Link
      {...link}
      color={notice.severity === "error" ? "red" : "amber"}
      underline="hover"
      className={className}
    >
      {content}
    </Link>
  ) : (
    <Box className={className}>{content}</Box>
  );
}

function NoticeCallout({
  notice,
  onUpgrade,
}: {
  notice: AppNotice;
  onUpgrade: (upgrade: Upgrade) => void;
}) {
  const link = noticeLink(notice, onUpgrade);
  return (
    <Callout status={notice.severity} size="sm">
      <Text size="inherit" weight="semibold">
        {link ? (
          <Link {...link} underline="always" className={styles.title}>
            {notice.title}
          </Link>
        ) : (
          notice.title
        )}
      </Text>
      {notice.details ? (
        <Box mt="1" className={styles["notice-tooltip"]}>
          {notice.details}
        </Box>
      ) : null}
    </Callout>
  );
}
