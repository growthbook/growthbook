import { Fragment } from "react";
import { Box } from "@radix-ui/themes";
import { FaExclamationTriangle } from "react-icons/fa";
import { PiWarningFill } from "react-icons/pi";
import {
  describeSdkPayloadSize,
  describeSdkPayloadSizeRecommendation,
  formatSdkPayloadBytes,
  getSdkPayloadSizeLevel,
  getSdkPayloadSizeRecommendations,
  SdkPayloadSizeFix,
  summarizeSdkPayloadSizeFixes,
  worstSdkPayloadSizeLevel,
} from "shared/health";
import {
  SdkPayloadSizeAlert,
  SdkPayloadSizeLevel,
  SdkPayloadSizeRecommendation,
} from "shared/validators";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useUser } from "@/services/UserContext";
import styles from "@/components/Layout/AccountPlanNotices.module.scss";

const isSevere = (level: SdkPayloadSizeLevel) =>
  level === "danger" || level === "over-limit";

const levelColor = (level: SdkPayloadSizeLevel) =>
  isSevere(level) ? "red" : "amber";

export function PayloadSizeIcon({
  connection,
}: {
  connection: SDKConnectionInterface;
}) {
  const size = connection.payloadSize;
  if (!size) return null;
  const level = getSdkPayloadSizeLevel(size);
  if (level === "ok") return null;
  return (
    <Tooltip body={describeSdkPayloadSize(size)}>
      <FaExclamationTriangle
        color={isSevere(level) ? "var(--red-11)" : "var(--amber-11)"}
      />
    </Tooltip>
  );
}

function EntryLinks({
  entries,
  href,
  level,
}: {
  entries: { id: string; bytes: number }[];
  href: (id: string) => string;
  // Omitted inside the tooltip, where links use the neutral text color
  level?: SdkPayloadSizeLevel;
}) {
  return (
    <>
      {entries.map((entry, i) => (
        <Fragment key={entry.id}>
          {i > 0 && ", "}
          <Link
            href={href(entry.id)}
            color={level ? levelColor(level) : "dark"}
            underline="hover"
          >
            {entry.id}
          </Link>{" "}
          ({formatSdkPayloadBytes(entry.bytes)})
        </Fragment>
      ))}
    </>
  );
}

function Recommendation({
  recommendation,
  level,
}: {
  recommendation: SdkPayloadSizeRecommendation;
  level: SdkPayloadSizeLevel;
}) {
  switch (recommendation.type) {
    case "large-features":
      return (
        <>
          Shrink the largest Feature Flags:{" "}
          <EntryLinks
            entries={recommendation.entries}
            href={(id) => `/features/${encodeURIComponent(id)}`}
            level={level}
          />
          . Large JSON values and long lists in conditions are the usual cause.
        </>
      );
    case "large-saved-groups":
      return (
        <>
          Shrink the largest Saved Groups:{" "}
          <EntryLinks
            entries={recommendation.entries}
            href={(id) => `/saved-groups/${encodeURIComponent(id)}`}
            level={level}
          />
          .
        </>
      );
    case "saved-group-references":
    case "limit-projects":
    case "optional-payload-settings":
      return (
        <>
          {describeSdkPayloadSizeRecommendation(recommendation, {
            withNames: true,
          })}
        </>
      );
  }
}

export function PayloadSizeCallout({
  connection,
}: {
  connection: SDKConnectionInterface;
}) {
  const size = connection.payloadSize;
  if (!size) return null;
  const level = getSdkPayloadSizeLevel(size);
  if (level === "ok") return null;
  const recommendations = getSdkPayloadSizeRecommendations(connection, size);
  return (
    <Callout status={isSevere(level) ? "error" : "warning"} mb="3">
      <Text weight="semibold">{describeSdkPayloadSize(size)}</Text>
      {recommendations.length > 0 && (
        <Box mt="2">
          Ways to shrink it:
          <Box asChild mt="1" mb="0" pl="4">
            <ul>
              {recommendations.map((r) => (
                <li key={r.type}>
                  <Recommendation recommendation={r} level={level} />
                </li>
              ))}
            </ul>
          </Box>
        </Box>
      )}
    </Callout>
  );
}

function alertsExplanation(
  alerts: SdkPayloadSizeAlert[],
  level: SdkPayloadSizeLevel,
) {
  const limit = formatSdkPayloadBytes(alerts[0].limitBytes);
  return level === "over-limit"
    ? `Over the ${limit} cache limit. SDKs get no updates until these payloads are smaller.`
    : `Nearing the ${limit} cache limit. Past it, SDKs get no updates.`;
}

function Fix({ fix }: { fix: SdkPayloadSizeFix }) {
  switch (fix.type) {
    case "saved-group-references":
      return (
        <>
          Send Saved Groups as references instead of inline on{" "}
          {pluralConnections(fix.connections)}
        </>
      );
    case "limit-projects":
      return (
        <>
          Limit {pluralConnections(fix.connections)} to the Projects their apps
          use
        </>
      );
    case "optional-payload-settings":
      return (
        <>
          Turn off unused payload options on{" "}
          {pluralConnections(fix.connections)}
        </>
      );
    case "large-features":
      return (
        <>
          Shrink these Feature Flags&apos; values:{" "}
          <EntryLinks
            entries={fix.entries}
            href={(id) => `/features/${encodeURIComponent(id)}`}
          />
        </>
      );
    case "large-saved-groups":
      return (
        <>
          Shrink these Saved Groups:{" "}
          <EntryLinks
            entries={fix.entries}
            href={(id) => `/saved-groups/${encodeURIComponent(id)}`}
          />
        </>
      );
  }
}

const pluralConnections = (count: number) =>
  `${count} SDK Connection${count === 1 ? "" : "s"}`;

export function PayloadSizeTopNavNotice() {
  const { sdkPayloadSizeAlerts } = useUser();
  if (!sdkPayloadSizeAlerts.length) return null;
  const level = worstSdkPayloadSizeLevel(
    sdkPayloadSizeAlerts.map((a) => a.level),
  );
  const connections =
    sdkPayloadSizeAlerts.length === 1 ? "SDK Connection" : "SDK Connections";
  const fixes = summarizeSdkPayloadSizeFixes(sdkPayloadSizeAlerts);
  return (
    <Tooltip
      body={
        <Box className={styles["notice-tooltip"]}>
          <Text as="p" mb="2">
            {alertsExplanation(sdkPayloadSizeAlerts, level)}
          </Text>
          {fixes.length > 0 && (
            <>
              <Text as="p" weight="semibold" mb="1">
                To fix:
              </Text>
              <Box asChild pl="4" mb="0">
                <ul>
                  {fixes.map((fix) => (
                    <li key={fix.type}>
                      <Fix fix={fix} />
                    </li>
                  ))}
                </ul>
              </Box>
            </>
          )}
        </Box>
      }
    >
      <Link
        href="/sdks"
        color={levelColor(level)}
        underline="hover"
        className={
          styles[
            isSevere(level) ? "error-notification" : "warning-notification"
          ]
        }
        style={{
          display: "inline-flex",
          alignItems: "center",
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        <PiWarningFill size={15} />
        {connections}{" "}
        {level === "over-limit" ? "over max size" : "nearing max size"}
        <Badge
          label={String(sdkPayloadSizeAlerts.length)}
          color={levelColor(level)}
          variant="solid"
          radius="full"
          size="xs"
        />
      </Link>
    </Tooltip>
  );
}
