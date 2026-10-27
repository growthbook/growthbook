import { useEffect, useRef, useState } from "react";
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
import { AppNotice, rankNotices } from "./notices";
import styles from "./NoticeStack.module.scss";

type Upgrade = NonNullable<AppNotice["upgrade"]>;

// The most important notice in full, and a "+N" that lists them all, so a
// crowded row stays one line.
export default function NoticeStack({ notices }: { notices: AppNotice[] }) {
  const [upgrade, setUpgrade] = useState<Upgrade | null>(null);
  const [listOpen, setListOpen] = useState(false);
  // Below 1180px the top notice's title can be cut off with "…"; the tooltip
  // then shows it in full, above its details.
  const pillRef = useRef<HTMLDivElement>(null);
  const [titleClipped, setTitleClipped] = useState(false);
  const checkClipped = () => {
    const text = pillRef.current?.querySelector(`.${styles.pillText}`);
    setTitleClipped(!!text && text.scrollWidth > text.clientWidth);
  };
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

  return (
    <Flex align="center" gap="2" className={styles.stack}>
      <Tooltip
        content={
          <Box className={styles["notice-tooltip"]}>
            {titleClipped ? (
              <Text as="div" weight="semibold">
                {top.title}
              </Text>
            ) : null}
            {top.details}
          </Box>
        }
        enabled={!!top.details || titleClipped}
      >
        <Flex
          ref={pillRef}
          display="inline-flex"
          className={styles.pillWrap}
          onMouseEnter={checkClipped}
          onFocus={checkClipped}
        >
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
          content={
            <Flex direction="column" gap="2">
              {ranked.map((notice) => (
                <NoticeCallout
                  key={notice.id}
                  notice={notice}
                  onUpgrade={setUpgrade}
                />
              ))}
            </Flex>
          }
        />
      ) : null}
      {upgrade ? (
        <UpgradeModal
          close={() => setUpgrade(null)}
          source={upgrade.source}
          commercialFeature={upgrade.commercialFeature}
        />
      ) : null}
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
      <span className={styles.pillText}>{notice.title}</span>
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
