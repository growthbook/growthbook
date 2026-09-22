import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Box, Flex } from "@radix-ui/themes";
import { PiCheck, PiCopy } from "react-icons/pi";
import type { EventLogRecord } from "shared/validators";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import styles from "./EventLogDetailDrawer.module.scss";

export const EVENT_LOG_DRAWER_ID = "event-log-detail-drawer";

/** Local time, to the millisecond — the table's own column stops at seconds. */
function formatPreciseTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const base = d.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return `${base}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

/**
 * Values carry their type: a string keeps visible quote marks so "12" is not
 * read as a number, while numbers, booleans and null render in teal.
 */
function TypedValue({ value }: { value: unknown }) {
  if (typeof value === "string") {
    return (
      <span className={styles.value}>
        <span className={styles.quote}>&quot;</span>
        <span className={styles.stringValue}>{value}</span>
        <span className={styles.quote}>&quot;</span>
      </span>
    );
  }
  return (
    <span className={`${styles.value} ${styles.scalarValue}`}>
      {value === null ? "null" : String(value)}
    </span>
  );
}

/**
 * One key column width for every section, so the values line up down the whole
 * drawer rather than stepping left where the keys happen to be shorter.
 */
function DetailRow({ label, value }: { label: string; value: unknown }) {
  return (
    <Flex className={styles.row}>
      <Box className={styles.key}>{label}</Box>
      <TypedValue value={value} />
    </Flex>
  );
}

interface Props {
  /** Null renders nothing at all. */
  event: EventLogRecord | null;
  onClose: () => void;
  /**
   * Filters the stream to this user. Not a link: the stream's filters are not
   * URL-synced, so there is no address for "this user's activity".
   */
  onFilterByUser?: (userId: string) => void;
}

export default function EventLogDetailDrawer({
  event,
  onClose,
  onFilterByUser,
}: Props) {
  const drawerRef = useRef<HTMLDivElement>(null);

  // Copying is silent otherwise — nothing on screen changes, so there is no way
  // to tell a successful copy from a missed click. The shared hook owns the
  // revert and its timer cleanup; 1.5s is long enough to read and short enough
  // that the button is back to its real label before it is wanted again.
  const { performCopy, copySuccess } = useCopyToClipboard({ timeout: 1500 });

  // The drawer renders at the Radix Theme root rather than in place. `position:
  // fixed` only resolves against the viewport while no ancestor establishes a
  // containing block — any `transform`, `filter` or `contain` up the tree
  // silently turns it into an absolutely-positioned box that scrolls with the
  // page and slides under the fixed top bar. The same ancestors would also cap
  // the z-index and could clip the drawer with `overflow`.
  //
  // The target is the theme root and not document.body: every colour here is a
  // Radix token, and those are custom properties declared on `.radix-themes`.
  // Outside it they resolve to nothing, so the panel fill drops to transparent
  // and the table shows straight through the drawer. The theme root is high
  // enough to clear the page's own ancestors while still inheriting the tokens,
  // and it declares no transform, contain or isolation of its own — so it
  // neither re-establishes a containing block nor a stacking context, and the
  // z-index still competes with the app chrome exactly as it reads.
  const [themeRoot, setThemeRoot] = useState<Element | null>(null);

  // Runs in an effect because document does not exist during SSR. The element
  // is held here rather than in a wrapper component so it is resolved once for
  // the life of the stream — a wrapper would unmount with the drawer on close
  // and re-render empty on the next open, running the focus effect below
  // against a ref that is still null.
  useEffect(() => {
    setThemeRoot(document.querySelector(".radix-themes") ?? document.body);
  }, []);

  // Focus moves in on open so the drawer is reachable from the keyboard
  // immediately. Focus is returned to the row's caret by the caller on close.
  useEffect(() => {
    if (event) drawerRef.current?.focus();
  }, [event]);

  useEffect(() => {
    if (!event) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [event, onClose]);

  if (!event || !themeRoot) return null;

  const properties = Object.entries(event.properties ?? {});
  const attributes = Object.entries(event.attributes ?? {});

  const context: { label: string; value: unknown }[] = [
    { label: "URL", value: event.url },
    // "(IP)" on purpose: there is also a user attribute called country, from a
    // different source, and the two can legitimately disagree.
    { label: "Country (IP)", value: event.geoCountry },
    { label: "Browser", value: event.uaBrowser },
    { label: "OS", value: event.uaOs },
    { label: "Device type", value: event.uaDeviceType },
    { label: "SDK", value: event.sdkLanguage },
    { label: "Device ID", value: event.deviceId },
  ];

  return createPortal(
    <>
      {/* aria-hidden: the drawer beside it already names what is open, and a
          bare scrim has nothing for a screen reader to announce. Escape closes
          it too, so this is not the only way out. */}
      <Box className={styles.overlay} onClick={onClose} aria-hidden />
      <Box
        ref={drawerRef}
        id={EVENT_LOG_DRAWER_ID}
        className={styles.drawer}
        role="region"
        aria-label={`Details for ${event.eventName}`}
        tabIndex={-1}
      >
        <Box className={styles.header}>
          <Box className={styles.eventName} title={event.eventName}>
            {event.eventName}
          </Box>
          {/* Wrapped because @/ui/Text takes no className, and only the spacing
            is ours — the type itself is the standard description treatment. */}
          <Box className={styles.timestamp}>
            <Text size="sm" color="text-mid">
              {formatPreciseTimestamp(event.timestamp)}
            </Text>
          </Box>
          <Flex className={styles.identityRow}>
            {event.userId ? (
              <button
                type="button"
                className={styles.userLink}
                title={event.userId}
                onClick={() => onFilterByUser?.(event.userId as string)}
              >
                {event.userId}
              </button>
            ) : (
              <span className={styles.noUser}>No user ID</span>
            )}
            {event.environment ? (
              // className carries the flex behaviour only: the badge must not
              // give up width to the user ID truncating beside it.
              <Badge
                label={event.environment}
                color="gray"
                variant="soft"
                className={styles.envBadge}
              />
            ) : null}
          </Flex>
        </Box>

        <Box className={styles.body}>
          <Box className={styles.sectionLabel}>Properties</Box>
          {properties.length > 0 ? (
            properties.map(([key, value]) => (
              <DetailRow key={key} label={key} value={value} />
            ))
          ) : (
            // Common rather than exceptional: Feature Evaluated rows carry
            // neither properties nor attributes.
            <Box className={styles.empty}>
              No properties were sent with this event.
            </Box>
          )}

          <Box className={`${styles.sectionLabel} ${styles.sectionSpaced}`}>
            User attributes
          </Box>
          {attributes.length > 0 ? (
            attributes.map(([key, value]) => (
              <DetailRow key={key} label={key} value={value} />
            ))
          ) : (
            <Box className={styles.empty}>
              No user attributes were sent with this event.
            </Box>
          )}

          <Box className={`${styles.sectionLabel} ${styles.sectionSpaced}`}>
            Context
          </Box>
          {context.map((row) => (
            <DetailRow key={row.label} label={row.label} value={row.value} />
          ))}
        </Box>

        <Flex className={styles.footer}>
          <Button
            variant="ghost"
            // One step down the Button scale (sm | md | lg | xl) from the md
            // default that Close keeps, so the secondary action sits quieter.
            size="sm"
            icon={
              copySuccess ? <PiCheck aria-hidden /> : <PiCopy aria-hidden />
            }
            iconPosition="left"
            onClick={() => performCopy(JSON.stringify(event, null, 2))}
          >
            {copySuccess ? "Copied!" : "Copy JSON"}
          </Button>
          <Button onClick={onClose}>Close</Button>
        </Flex>
      </Box>
    </>,
    themeRoot,
  );
}
