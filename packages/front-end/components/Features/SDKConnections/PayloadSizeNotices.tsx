import { Fragment } from "react";
import { Box } from "@radix-ui/themes";
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
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import HelperText from "@/ui/HelperText";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import { AppNotice } from "@/components/Notices/notices";
import styles from "@/components/Notices/NoticeStack.module.scss";

const isSevere = (level: SdkPayloadSizeLevel) =>
  level === "danger" || level === "over-limit";

export function PayloadSizeRowWarning({
  connection,
}: {
  connection: SDKConnectionInterface;
}) {
  const size = connection.payloadSize;
  if (!size) return null;
  const level = getSdkPayloadSizeLevel(size);
  if (level === "ok") return null;
  const share = Math.floor((size.bytes / size.limitBytes) * 100);
  return (
    // Its own line, but only as wide as its text, so the hover area is the label
    <Box mt="1">
      <Tooltip
        body={
          <Box className={styles["notice-tooltip"]}>
            <PayloadSizeAdvice connection={connection} size={size} />
          </Box>
        }
      >
        <Box display="inline-block">
          <HelperText status={isSevere(level) ? "error" : "warning"} size="sm">
            {level === "over-limit" ? "Over max size" : "Nearing max size"} ·{" "}
            {share}%
          </HelperText>
        </Box>
      </Tooltip>
    </Box>
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
  return (
    <Callout status={isSevere(level) ? "error" : "warning"} mb="3">
      <PayloadSizeAdvice connection={connection} size={size} />
    </Callout>
  );
}

function PayloadSizeAdvice({
  connection,
  size,
}: {
  connection: SDKConnectionInterface;
  size: NonNullable<SDKConnectionInterface["payloadSize"]>;
}) {
  const recommendations = getSdkPayloadSizeRecommendations(connection, size);
  return (
    <>
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
    </>
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

export function usePayloadSizeNotices(): AppNotice[] {
  const { sdkPayloadSizeAlerts } = useUser();
  if (!sdkPayloadSizeAlerts.length) return [];
  const level = worstSdkPayloadSizeLevel(
    sdkPayloadSizeAlerts.map((a) => a.level),
  );
  // The title names the worst level, so it counts only connections at it
  const count =
    level === "over-limit"
      ? sdkPayloadSizeAlerts.filter((a) => a.level === "over-limit").length
      : sdkPayloadSizeAlerts.length;
  const fixes = summarizeSdkPayloadSizeFixes(sdkPayloadSizeAlerts);
  return [
    {
      id: "sdk-payload-size",
      severity: isSevere(level) ? "error" : "warning",
      title: `${count === 1 ? "" : `${count} `}${connectionsNoun(count)} ${
        level === "over-limit" ? "over max size" : "nearing max size"
      }`,
      href: "/sdks",
      details: (
        <>
          <Text as="p" size="inherit" mb="2">
            {alertsExplanation(sdkPayloadSizeAlerts)}
          </Text>
          {fixes.length > 0 && (
            <>
              <Text as="p" size="inherit" weight="semibold" mb="1">
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
        </>
      ),
    },
  ];
}
