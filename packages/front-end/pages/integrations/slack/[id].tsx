import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { SlackOAuthIntegrationInterface } from "shared/types/slack-integration";
import {
  SLACK_EVENT_OPTIONS,
  SlackEventCategory,
  selectedSlackOptionIds,
  isEventWebhookWildcard,
  slackDigestFrequencies,
  SLACK_DIGEST_LIVE_FREQUENCIES,
  resolveSlackDigest,
  experimentCardFormats,
  DEFAULT_SLACK_DIGEST_HOUR_UTC,
  type SlackDigestFrequency,
} from "shared/validators";
import { Box, Flex, Grid } from "@radix-ui/themes";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import PageHead from "@/components/Layout/PageHead";
import LoadingOverlay from "@/components/LoadingOverlay";
import Frame from "@/ui/Frame";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Switch from "@/ui/Switch";
import Checkbox from "@/ui/Checkbox";
import { Select, SelectItem } from "@/ui/Select";

type SlackIntegrationsResponse = {
  slackIntegrations: SlackOAuthIntegrationInterface[];
  oauthConfigured: boolean;
};

const CARD_FORMAT_LABELS: Record<
  (typeof experimentCardFormats)[number],
  string
> = {
  none: "No card — text only",
  compact: "Compact card",
  detailed: "Detailed card",
};

const FREQUENCY_LABELS: Record<SlackDigestFrequency, string> = {
  off: "Off — no digest",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  custom: "Custom",
};

const DAY_OF_WEEK_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const CATEGORY_META: Record<
  SlackEventCategory,
  { label: string; description: string }
> = {
  experiment: {
    label: "Experiment notifications",
    description:
      "Launches, results, decisions, and health warnings for experiments.",
  },
  feature: {
    label: "Feature flag notifications",
    description: "Published versions, safe rollouts, drafts, and reviews.",
  },
};

const CATALOG_EVENTS = new Set(SLACK_EVENT_OPTIONS.flatMap((o) => o.events));

const getChannelLabel = (i: SlackOAuthIntegrationInterface) =>
  i.slack?.channelName || i.slack?.channelId || i.name;

const getWorkspaceLabel = (i: SlackOAuthIntegrationInterface) =>
  i.slack?.teamName ||
  i.slack?.teamId ||
  i.slack?.enterpriseName ||
  i.slack?.enterpriseId ||
  "Unknown workspace";

// Ordered, de-duplicated list of groups for a category (keeps catalog order).
const groupsForCategory = (category: SlackEventCategory): string[] => {
  const seen = new Set<string>();
  const groups: string[] = [];
  SLACK_EVENT_OPTIONS.forEach((o) => {
    if (o.category !== category || seen.has(o.group)) return;
    seen.add(o.group);
    groups.push(o.group);
  });
  return groups;
};

const HOURS = Array.from({ length: 24 }, (_, h) => h);

const SlackIntegrationDetailPage = () => {
  const router = useRouter();
  const { apiCall } = useAuth();
  const permissionsUtils = usePermissionsUtil();
  const id = Array.isArray(router.query.id)
    ? router.query.id[0]
    : router.query.id;

  const { data, mutate, error } = useApi<SlackIntegrationsResponse>(
    "/integrations/slack",
  );

  const integration = useMemo(
    () => (data?.slackIntegrations || []).find((i) => i.id === id),
    [data?.slackIntegrations, id],
  );

  // ---- Form state ----
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cardFormat, setCardFormat] =
    useState<(typeof experimentCardFormats)[number]>("compact");
  const [frequency, setFrequency] = useState<SlackDigestFrequency>("off");
  const [hourUtc, setHourUtc] = useState(DEFAULT_SLACK_DIGEST_HOUR_UTC);
  const [dayOfWeekUtc, setDayOfWeekUtc] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [showAdvanced, setShowAdvanced] = useState<Set<SlackEventCategory>>(
    new Set(),
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Hydrate form when the integration loads.
  useEffect(() => {
    if (!integration) return;
    setSelected(selectedSlackOptionIds(integration.events));
    setCardFormat(integration.slackOptions?.experimentCardFormat ?? "compact");
    const digest = resolveSlackDigest(integration.slackOptions, {
      dailyDigestHourUtc: integration.dailyDigestHourUtc,
    });
    setFrequency(digest.frequency);
    setHourUtc(digest.hourUtc);
    setDayOfWeekUtc(digest.dayOfWeekUtc);
    setDayOfMonth(digest.dayOfMonth);
  }, [integration]);

  const setOptionSelected = (optionId: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(optionId);
      else next.delete(optionId);
      return next;
    });
    setSaved(false);
  };

  const setCategoryEnabled = (category: SlackEventCategory, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      SLACK_EVENT_OPTIONS.forEach((o) => {
        if (o.category !== category) return;
        // Enabling restores the curated defaults; disabling clears the category.
        if (on && o.defaultOn) next.add(o.id);
        if (!on) next.delete(o.id);
      });
      return next;
    });
    setSaved(false);
  };

  const categoryEnabled = (category: SlackEventCategory) =>
    SLACK_EVENT_OPTIONS.some(
      (o) => o.category === category && selected.has(o.id),
    );

  const toggleAdvanced = (category: SlackEventCategory) =>
    setShowAdvanced((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });

  const save = async () => {
    if (!integration) return;
    setSaving(true);
    setSaveError(null);
    try {
      const selectedEvents = SLACK_EVENT_OPTIONS.filter((o) =>
        selected.has(o.id),
      ).flatMap((o) => o.events);
      // Preserve any explicit (non-wildcard) subscriptions that aren't
      // represented in the Slack catalog; drop wildcards (converted to
      // explicit selections above).
      const preserved = integration.events.filter(
        (e) => !isEventWebhookWildcard(e) && !CATALOG_EVENTS.has(e),
      );
      const events = [...new Set([...selectedEvents, ...preserved])];

      if (events.length === 0) {
        setSaveError("Select at least one event to notify this channel about.");
        setSaving(false);
        return;
      }

      const digest =
        frequency === "off"
          ? { frequency }
          : {
              frequency,
              hourUtc,
              ...(frequency === "weekly" ? { dayOfWeekUtc } : {}),
              ...(frequency === "monthly" || frequency === "quarterly"
                ? { dayOfMonth }
                : {}),
            };

      await apiCall(`/event-webhooks/${integration.eventWebHookId}`, {
        method: "PUT",
        body: JSON.stringify({
          events,
          slackOptions: {
            experimentCardFormat: cardFormat,
            digest,
          },
        }),
      });
      await mutate();
      setSaved(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  };

  if (!permissionsUtils.canManageIntegrations()) {
    return (
      <div className="container-fluid pagecontents">
        <Callout status="error">
          You do not have access to view this page.
        </Callout>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container-fluid pagecontents">
        <Callout status="error">
          Failed to load Slack integrations: {error.message}
        </Callout>
      </div>
    );
  }

  if (!data) return <LoadingOverlay />;

  if (!integration) {
    return (
      <div className="container-fluid pagecontents">
        <PageHead
          breadcrumb={[
            { display: "Slack", href: "/integrations/slack" },
            { display: "Not found" },
          ]}
        />
        <Callout status="error">
          This Slack channel is no longer connected.
        </Callout>
      </div>
    );
  }

  const noneSelected = selected.size === 0;

  return (
    <div className="container-fluid pagecontents">
      <PageHead
        breadcrumb={[
          { display: "Slack", href: "/integrations/slack" },
          { display: getChannelLabel(integration) },
        ]}
      />

      <Flex direction="column" gap="4" style={{ maxWidth: 820 }}>
        <Box>
          <Heading as="h1" size="large" mb="1">
            {getChannelLabel(integration)}
          </Heading>
          <Text color="text-mid">{getWorkspaceLabel(integration)}</Text>
        </Box>

        {/* Notifications */}
        <Frame>
          <Heading as="h2" size="small" mb="1">
            Notifications
          </Heading>
          <Text as="p" color="text-mid" mb="4">
            Choose what this channel is notified about. Turn a category on for
            the recommended set, or expand it to pick individual events.
          </Text>

          <Flex direction="column" gap="4">
            {(["experiment", "feature"] as SlackEventCategory[]).map(
              (category) => {
                const enabled = categoryEnabled(category);
                const advancedOpen = showAdvanced.has(category);
                return (
                  <Box
                    key={category}
                    style={{
                      border: "1px solid var(--gray-a5)",
                      borderRadius: "var(--radius-4)",
                      padding: "var(--space-4)",
                    }}
                  >
                    <Flex justify="between" align="start" gap="3">
                      <Switch
                        label={CATEGORY_META[category].label}
                        description={CATEGORY_META[category].description}
                        value={enabled}
                        onChange={(v) => setCategoryEnabled(category, v)}
                      />
                      <Button
                        variant="ghost"
                        color="gray"
                        size="xs"
                        onClick={() => toggleAdvanced(category)}
                      >
                        {advancedOpen ? "Hide events" : "Customize events"}
                      </Button>
                    </Flex>

                    {advancedOpen && (
                      <Box
                        mt="4"
                        pt="4"
                        style={{ borderTop: "1px solid var(--gray-a4)" }}
                      >
                        <Flex direction="column" gap="4">
                          {groupsForCategory(category).map((group) => (
                            <Box key={group}>
                              <Text
                                size="small"
                                weight="medium"
                                color="text-mid"
                                as="div"
                                mb="2"
                              >
                                {group}
                              </Text>
                              <Grid
                                columns={{ initial: "1", sm: "2" }}
                                gapX="4"
                                gapY="3"
                              >
                                {SLACK_EVENT_OPTIONS.filter(
                                  (o) =>
                                    o.category === category &&
                                    o.group === group,
                                ).map((o) => (
                                  <Checkbox
                                    key={o.id}
                                    label={o.label}
                                    description={o.description}
                                    value={selected.has(o.id)}
                                    setValue={(v) => setOptionSelected(o.id, v)}
                                  />
                                ))}
                              </Grid>
                            </Box>
                          ))}
                        </Flex>
                      </Box>
                    )}
                  </Box>
                );
              },
            )}
          </Flex>

          {noneSelected && (
            <Callout status="warning" mt="4">
              No events selected — this channel won&rsquo;t receive live
              notifications.
            </Callout>
          )}
        </Frame>

        {/* Results card */}
        <Frame>
          <Heading as="h2" size="small" mb="1">
            Results card
          </Heading>
          <Text as="p" color="text-mid" mb="4">
            The image posted for experiment results (started, significance,
            won/lost, stopped, health).
          </Text>
          <Box style={{ maxWidth: 320 }}>
            <Select
              label="Card style"
              value={cardFormat}
              setValue={(v) =>
                setCardFormat(v as (typeof experimentCardFormats)[number])
              }
            >
              {experimentCardFormats.map((f) => (
                <SelectItem key={f} value={f}>
                  {CARD_FORMAT_LABELS[f]}
                </SelectItem>
              ))}
            </Select>
          </Box>
        </Frame>

        {/* Digest */}
        <Frame>
          <Heading as="h2" size="small" mb="1">
            Digest
          </Heading>
          <Text as="p" color="text-mid" mb="4">
            A rolled-up summary on a schedule. Daily is a text recap; weekly is
            the experimentation scorecard.
          </Text>

          <Flex direction="column" gap="4" style={{ maxWidth: 420 }}>
            <Select
              label="Frequency"
              value={frequency}
              setValue={(v) => {
                setFrequency(v as SlackDigestFrequency);
                setSaved(false);
              }}
            >
              {slackDigestFrequencies.map((f) => {
                const live =
                  f === "off" || SLACK_DIGEST_LIVE_FREQUENCIES.has(f);
                return (
                  <SelectItem key={f} value={f}>
                    {FREQUENCY_LABELS[f]}
                    {live ? "" : " (coming soon)"}
                  </SelectItem>
                );
              })}
            </Select>

            {frequency !== "off" && (
              <>
                {frequency === "weekly" && (
                  <Select
                    label="Day of week"
                    value={`${dayOfWeekUtc}`}
                    setValue={(v) => {
                      setDayOfWeekUtc(Number(v));
                      setSaved(false);
                    }}
                  >
                    {DAY_OF_WEEK_LABELS.map((label, i) => (
                      <SelectItem key={i} value={`${i}`}>
                        {label}
                      </SelectItem>
                    ))}
                  </Select>
                )}

                {(frequency === "monthly" || frequency === "quarterly") && (
                  <Select
                    label="Day of month"
                    value={`${dayOfMonth}`}
                    setValue={(v) => {
                      setDayOfMonth(Number(v));
                      setSaved(false);
                    }}
                  >
                    {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                      <SelectItem key={d} value={`${d}`}>
                        {d}
                      </SelectItem>
                    ))}
                  </Select>
                )}

                <Select
                  label="Time (UTC)"
                  value={`${hourUtc}`}
                  setValue={(v) => {
                    setHourUtc(Number(v));
                    setSaved(false);
                  }}
                >
                  {HOURS.map((h) => (
                    <SelectItem key={h} value={`${h}`}>
                      {`${h.toString().padStart(2, "0")}:00`}
                    </SelectItem>
                  ))}
                </Select>

                {!SLACK_DIGEST_LIVE_FREQUENCIES.has(frequency) && (
                  <Callout status="info" mb="0">
                    {FREQUENCY_LABELS[frequency]} digests are coming soon — your
                    choice is saved and will start delivering once it&rsquo;s
                    available.
                  </Callout>
                )}
              </>
            )}
          </Flex>
        </Frame>

        {saveError && <Callout status="error">{saveError}</Callout>}

        <Flex gap="3" align="center">
          <Button onClick={save} loading={saving}>
            Save settings
          </Button>
          {saved && (
            <Text color="text-mid" size="small">
              Saved.
            </Text>
          )}
        </Flex>
      </Flex>
    </div>
  );
};

export default SlackIntegrationDetailPage;
