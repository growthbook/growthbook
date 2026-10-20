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
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { RadixStatusIcon } from "@/ui/HelperText";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useDefinitions } from "@/services/DefinitionsContext";
import { AppNotice } from "@/components/Notices/notices";
import { usePayloadSizeAlertsInput } from "@/components/Notices/prototypeNotices";

const isSevere = (level: SdkPayloadSizeLevel) =>
  level === "danger" || level === "over-limit";

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

// The header's notice (NoticeStack), ported from main (set in review; was
// PayloadSizeTopNavNotice, its own pill).
export function usePayloadSizeNotices(): AppNotice[] {
  // PROTOTYPE (set in review): the real alerts, or the prototype panel's
  // fakes when it's switched on there (prototypeNotices.ts). On main:
  // useUser().
  const sdkPayloadSizeAlerts = usePayloadSizeAlertsInput();
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
