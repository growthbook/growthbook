import { Box, Flex } from "@radix-ui/themes";
import { PiCheck, PiCopy } from "react-icons/pi";
import type { EventLogRecord } from "shared/validators";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import DetailDrawer, {
  DetailEmpty,
  DetailRow,
  DetailSectionLabel,
  formatPreciseTimestamp,
} from "@/components/Diagnostics/DetailDrawer";
import styles from "./EventLogDetailDrawer.module.scss";

export const EVENT_LOG_DRAWER_ID = "event-log-detail-drawer";

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
  // Copying is silent otherwise — nothing on screen changes, so there is no way
  // to tell a successful copy from a missed click. The shared hook owns the
  // revert and its timer cleanup; 1.5s is long enough to read and short enough
  // that the button is back to its real label before it is wanted again.
  const { performCopy, copySuccess } = useCopyToClipboard({ timeout: 1500 });

  // The shell stays mounted while closed (it resolves its portal target once
  // for the life of the stream), so this renders it either way.
  return (
    <DetailDrawer
      open={!!event}
      onClose={onClose}
      id={EVENT_LOG_DRAWER_ID}
      ariaLabel={event ? `Details for ${event.eventName}` : ""}
      focusKey={event}
      header={
        event ? (
          <EventHeader event={event} onFilterByUser={onFilterByUser} />
        ) : null
      }
      footer={
        event ? (
          <>
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
          </>
        ) : null
      }
    >
      {event ? <EventBody event={event} /> : null}
    </DetailDrawer>
  );
}

function EventHeader({
  event,
  onFilterByUser,
}: {
  event: EventLogRecord;
  onFilterByUser?: (userId: string) => void;
}) {
  return (
    <>
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
    </>
  );
}

function EventBody({ event }: { event: EventLogRecord }) {
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

  return (
    <>
      <DetailSectionLabel>Properties</DetailSectionLabel>
      {properties.length > 0 ? (
        properties.map(([key, value]) => (
          <DetailRow key={key} label={key} value={value} />
        ))
      ) : (
        // Common rather than exceptional: Feature Evaluated rows carry
        // neither properties nor attributes.
        <DetailEmpty>No properties were sent with this event.</DetailEmpty>
      )}

      <DetailSectionLabel spaced>User attributes</DetailSectionLabel>
      {attributes.length > 0 ? (
        attributes.map(([key, value]) => (
          <DetailRow key={key} label={key} value={value} />
        ))
      ) : (
        <DetailEmpty>No user attributes were sent with this event.</DetailEmpty>
      )}

      <DetailSectionLabel spaced>Context</DetailSectionLabel>
      {context.map((row) => (
        <DetailRow key={row.label} label={row.label} value={row.value} />
      ))}
    </>
  );
}
