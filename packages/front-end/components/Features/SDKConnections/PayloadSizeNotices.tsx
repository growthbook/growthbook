import { Fragment } from "react";
import { Box } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
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
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import HelperText from "@/ui/HelperText";
import Tooltip from "@/ui/Tooltip";
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
        content={
          <Box className={styles["notice-tooltip"]}>
            <PayloadSizeAdvice connection={connection} size={size} />
          </Box>
        }
      >
        <Box display="inline-block" tabIndex={0}>
          <HelperText status={isSevere(level) ? "error" : "warning"} size="sm">
            {level === "over-limit" ? (
              <Trans>Over max size</Trans>
            ) : (
              <Trans>Nearing max size</Trans>
            )}{" "}
            · {share}%
          </HelperText>
        </Box>
      </Tooltip>
    </Box>
  );
}

function StaleFeaturesLink() {
  return (
    <Link href="/features?q=is%3Astale" underline="always">
      <Trans>Archive stale Feature Flags</Trans>
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
        <Trans>
          Shrink the largest Feature Flags:{" "}
          <EntryLinks entries={recommendation.entries} kind="feature" />. Large
          JSON values and long lists in conditions are the usual cause.
        </Trans>
      );
    case "large-saved-groups":
      return (
        <Trans>
          Shrink the largest Saved Groups:{" "}
          <EntryLinks entries={recommendation.entries} kind="saved-group" />.
        </Trans>
      );
    case "archive-stale-features":
      return (
        <Trans>
          <StaleFeaturesLink />, which stay in the payload until archived.
        </Trans>
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
  mt,
  mb = "3",
}: {
  connection: SDKConnectionInterface;
} & Pick<MarginProps, "mt" | "mb">) {
  const size = connection.payloadSize;
  if (!size) return null;
  const level = getSdkPayloadSizeLevel(size);
  if (level === "ok") return null;
  return (
    <Callout status={isSevere(level) ? "error" : "warning"} mt={mt} mb={mb}>
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
          <Trans>Ways to shrink it:</Trans>
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

function AlertsExplanation({ alerts }: { alerts: SdkPayloadSizeAlert[] }) {
  const { t } = useLingui();
  const limit = formatSdkPayloadBytes(alerts[0].limitBytes);
  const over = alerts.filter((a) => a.level === "over-limit").length;
  const nearing = alerts.length - over;
  if (!over) {
    return (
      <>
        {nearing === 1
          ? t`${nearing} SDK Connection nearing the ${limit} cache limit. Past it, SDKs get no updates.`
          : t`${nearing} SDK Connections nearing the ${limit} cache limit. Past it, SDKs get no updates.`}
      </>
    );
  }
  if (nearing) {
    return (
      <>
        {over === 1
          ? t`${over} SDK Connection over the ${limit} cache limit and ${nearing} nearing it. Over it, SDKs get no updates until the payload is smaller.`
          : t`${over} SDK Connections over the ${limit} cache limit and ${nearing} nearing it. Over it, SDKs get no updates until the payload is smaller.`}
      </>
    );
  }
  return (
    <>
      {over === 1
        ? t`${over} SDK Connection over the ${limit} cache limit. Over it, SDKs get no updates until the payload is smaller.`
        : t`${over} SDK Connections over the ${limit} cache limit. Over it, SDKs get no updates until the payload is smaller.`}
    </>
  );
}

function Fix({ fix }: { fix: SdkPayloadSizeFix }) {
  switch (fix.type) {
    case "archive-stale-features":
      return <StaleFeaturesLink />;
    case "saved-group-references": {
      const connections = fix.connections;
      return (
        <Plural
          value={connections}
          one="Send Saved Groups as references instead of inline on # SDK Connection"
          other="Send Saved Groups as references instead of inline on # SDK Connections"
        />
      );
    }
    case "limit-projects": {
      const connections = fix.connections;
      return (
        <Plural
          value={connections}
          one="Limit # SDK Connection to the Projects their apps use"
          other="Limit # SDK Connections to the Projects their apps use"
        />
      );
    }
    case "optional-payload-settings": {
      const connections = fix.connections;
      return (
        <Plural
          value={connections}
          one="Turn off unused payload options on # SDK Connection"
          other="Turn off unused payload options on # SDK Connections"
        />
      );
    }
    case "large-features":
      return (
        <Trans>
          Shrink these Feature Flags&apos; values:{" "}
          <EntryLinks entries={fix.entries} kind="feature" />
        </Trans>
      );
    case "large-saved-groups":
      return (
        <Trans>
          Shrink these Saved Groups:{" "}
          <EntryLinks entries={fix.entries} kind="saved-group" />
        </Trans>
      );
  }
}

export function usePayloadSizeNotices(): AppNotice[] {
  const { t } = useLingui();
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
      title:
        level === "over-limit"
          ? count === 1
            ? t`SDK Connection over max size`
            : t`${count} SDK Connections over max size`
          : count === 1
            ? t`SDK Connection nearing max size`
            : t`${count} SDK Connections nearing max size`,
      href: "/sdks",
      details: (
        <>
          <Text as="p" size="inherit" mb="2">
            <AlertsExplanation alerts={sdkPayloadSizeAlerts} />
          </Text>
          {fixes.length > 0 && (
            <>
              <Text as="p" size="inherit" weight="semibold" mb="1">
                <Trans>To fix:</Trans>
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
