import { useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex } from "@radix-ui/themes";
import { PiWarningFill } from "react-icons/pi";
import clsx from "clsx";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import { Popover } from "@/ui/Popover";
import Text from "@/ui/Text";
import Tooltip from "@/components/Tooltip/Tooltip";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import { AppNotice } from "./notices";
import styles from "./NoticeStack.module.scss";

type Upgrade = NonNullable<AppNotice["upgrade"]>;

// The most important notice in full, and a "+N" that lists them all, so a
// crowded row stays one line.
export default function NoticeStack({ notices }: { notices: AppNotice[] }) {
  const [upgrade, setUpgrade] = useState<Upgrade | null>(null);
  if (!notices.length) return null;
  const [top, ...rest] = notices;

  return (
    <Flex align="center" gap="2" flexShrink="0">
      <Tooltip
        body={
          top.details ? (
            <Box className={styles["notice-tooltip"]}>{top.details}</Box>
          ) : null
        }
        shouldDisplay={!!top.details}
      >
        <NoticePill notice={top} onUpgrade={setUpgrade} />
      </Tooltip>
      {rest.length ? (
        <Popover
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
              {notices.map((notice) => (
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
  const color = notice.severity === "error" ? "red" : "amber";
  const content = (
    <>
      <PiWarningFill size={15} />
      {notice.title}
    </>
  );
  if (notice.href) {
    return (
      <Link
        href={notice.href}
        color={color}
        underline="hover"
        className={className}
      >
        {content}
      </Link>
    );
  }
  if (notice.upgrade) {
    const upgrade = notice.upgrade;
    return (
      <Link
        color={color}
        underline="hover"
        className={className}
        onClick={() => onUpgrade(upgrade)}
      >
        {content}
      </Link>
    );
  }
  return <Box className={className}>{content}</Box>;
}

function NoticeCallout({
  notice,
  onUpgrade,
}: {
  notice: AppNotice;
  onUpgrade: (upgrade: Upgrade) => void;
}) {
  const { pathname } = useRouter();
  const upgrade = notice.upgrade;
  // Already on the page it points to
  const href = notice.href !== pathname ? notice.href : undefined;
  return (
    <Callout status={notice.severity} size="sm">
      <Text size="inherit" weight="semibold">
        {href ? (
          <Link href={href} underline="always" className={styles.title}>
            {notice.title}
          </Link>
        ) : upgrade ? (
          <Link
            onClick={() => onUpgrade(upgrade)}
            underline="always"
            className={styles.title}
          >
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
