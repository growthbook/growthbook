import { Fragment } from "react";
import { Box } from "@radix-ui/themes";
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
import { RadixStatusIcon } from "@/ui/HelperText";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
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
      <PiWarningFill
        color={isSevere(level) ? "var(--red-11)" : "var(--amber-11)"}
      />
    </Tooltip>
  );
}

function StaleFeaturesLink() {
  return (
    <Link href="/features?q=is%3Astale" underline="always">
      Archive stale Feature Flags
    </Link>
  );
}

function EntryLinks({
  entries,
  kind,
}: {
  entries: { id: string; bytes: number }[];
  kind: "feature" | "saved-group";
}) {
  const { getSavedGroupById } = useDefinitions();
  return (
    <>
      {entries.map((entry, i) => (
        <Fragment key={entry.id}>
          {i > 0 && ", "}
          {kind === "feature" ? (
            <Link
              href={`/features/${encodeURIComponent(entry.id)}`}
              underline="always"
            >
              {entry.id}
            </Link>
          ) : (
            <Link
              href={`/saved-groups/${encodeURIComponent(entry.id)}`}
              underline="always"
            >
              {getSavedGroupById(entry.id)?.groupName ?? entry.id}
            </Link>
          )}{" "}
          ({formatSdkPayloadBytes(entry.bytes)})
        </Fragment>
      ))}
    </>
  );
}

function Recommendation({
  recommendation,
}: {
  recommendation: SdkPayloadSizeRecommendation;
}) {
  switch (recommendation.type) {
    case "large-features":
      return (
        <>
          Shrink the largest Feature Flags:{" "}
          <EntryLinks entries={recommendation.entries} kind="feature" />. Large
          JSON values and long lists in conditions are the usual cause.
        </>
      );
    case "large-saved-groups":
      return (
        <>
          Shrink the largest Saved Groups:{" "}
          <EntryLinks entries={recommendation.entries} kind="saved-group" />.
        </>
      );
    case "archive-stale-features":
      return (
        <>
          <StaleFeaturesLink />, which stay in the payload until archived.
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
    <Callout
      status={isSevere(level) ? "error" : "warning"}
      icon={<RadixStatusIcon status="warning" size="md" />}
      mb="3"
    >
      <Text weight="semibold">{describeSdkPayloadSize(size)}</Text>
      {recommendations.length > 0 && (
        <Box mt="2">
          Ways to shrink it:
          <Box asChild mt="1" mb="0" pl="4">
            <ul>
              {recommendations.map((r) => (
                <li key={r.type}>
                  <Recommendation recommendation={r} />
                </li>
              ))}
            </ul>
          </Box>
        </Box>
      )}
    </Callout>
  );
}

function alertsExplanation(alerts: SdkPayloadSizeAlert[]) {
  const limit = formatSdkPayloadBytes(alerts[0].limitBytes);
  const over = alerts.filter((a) => a.level === "over-limit").length;
  const nearing = alerts.length - over;
  if (!over) {
    return `${pluralConnections(nearing)} nearing the ${limit} cache limit. Past it, SDKs get no updates.`;
  }
  const others = nearing ? ` and ${nearing} nearing it` : "";
  return `${pluralConnections(over)} over the ${limit} cache limit${others}. Over it, SDKs get no updates until the payload is smaller.`;
}

function Fix({ fix }: { fix: SdkPayloadSizeFix }) {
  switch (fix.type) {
    case "archive-stale-features":
      return <StaleFeaturesLink />;
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
          <EntryLinks entries={fix.entries} kind="feature" />
        </>
      );
    case "large-saved-groups":
      return (
        <>
          Shrink these Saved Groups:{" "}
          <EntryLinks entries={fix.entries} kind="saved-group" />
        </>
      );
  }
}

const connectionsNoun = (count: number) =>
  count === 1 ? "SDK Connection" : "SDK Connections";

const pluralConnections = (count: number) =>
  `${count} ${connectionsNoun(count)}`;

export function PayloadSizeTopNavNotice() {
  const { sdkPayloadSizeAlerts } = useUser();
  if (!sdkPayloadSizeAlerts.length) return null;
  const level = worstSdkPayloadSizeLevel(
    sdkPayloadSizeAlerts.map((a) => a.level),
  );
  // The pill names the worst level, so it counts only connections at it
  const count =
    level === "over-limit"
      ? sdkPayloadSizeAlerts.filter((a) => a.level === "over-limit").length
      : sdkPayloadSizeAlerts.length;
  const fixes = summarizeSdkPayloadSizeFixes(sdkPayloadSizeAlerts);
  return (
    <Tooltip
      body={
        <Box className={styles["notice-tooltip"]}>
          <Text as="p" mb="2">
            {alertsExplanation(sdkPayloadSizeAlerts)}
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
        {connectionsNoun(count)}{" "}
        {level === "over-limit" ? "over max size" : "nearing max size"}
        <Badge
          label={String(count)}
          color={levelColor(level)}
          variant="solid"
          radius="full"
          size="xs"
        />
      </Link>
    </Tooltip>
  );
}
