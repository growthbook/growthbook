import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { SlackOAuthIntegrationInterface } from "shared/types/slack-integration";
import {
  SLACK_EVENT_OPTIONS,
  SlackEventCategory,
  selectedSlackOptionIds,
  defaultSlackOptionIds,
  isEventWebhookWildcard,
  slackDigestFrequencies,
  resolveExperimentDigest,
  resolveFeatureDigest,
  experimentCardFormats,
  DEFAULT_SLACK_DIGEST_HOUR_UTC,
  DEFAULT_SLACK_DIGEST_INTERVAL_DAYS,
  type SlackDigestFrequency,
  type ResolvedSlackDigest,
} from "shared/validators";
import { Box, Flex, Grid } from "@radix-ui/themes";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useEnvironments } from "@/services/features";
import { useDefinitions } from "@/services/DefinitionsContext";
import PageHead from "@/components/Layout/PageHead";
import LoadingOverlay from "@/components/LoadingOverlay";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Field from "@/components/Forms/Field";
import TagsInput from "@/components/Tags/TagsInput";
import Frame from "@/ui/Frame";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import HelperText from "@/ui/HelperText";
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

// Per-subject copy. Each subject section owns its event notifications and its
// scheduled digest.
const SUBJECT_META: Record<
  SlackEventCategory,
  {
    heading: string;
    description: string;
    events: string;
    digest: string;
  }
> = {
  experiment: {
    heading: "Experiments",
    description:
      "What this channel hears about experiments, plus an optional rolled-up digest.",
    events: "Launches, results, decisions, and health warnings.",
    digest:
      "A rolled-up summary of experiment activity. Weekly and longer post the experimentation scorecard.",
  },
  feature: {
    heading: "Feature flags",
    description:
      "What this channel hears about feature flags, plus an optional rolled-up digest.",
    events: "Published versions, safe rollouts, drafts, and reviews.",
    digest:
      "A recap of feature-flag activity — versions published/reverted, safe-rollout outcomes, stale candidates, and reviews.",
  },
};

const CATALOG_EVENTS = new Set(SLACK_EVENT_OPTIONS.flatMap((o) => o.events));

// Scopes added after the earliest installs; if a connection is missing any of
// these we prompt the user to reconnect. Keep in sync with SLACK_OAUTH_SCOPE.
const REQUIRED_SCOPES = ["channels:read", "groups:read"];

const getChannelLabel = (i: SlackOAuthIntegrationInterface) => {
  const name = i.slack?.channelName;
  // Prefix the resolved channel name with "#" (once) so it reads like Slack.
  // The channel-id / webhook-name fallbacks are left as-is.
  if (name) return name.startsWith("#") ? name : `#${name}`;
  return i.slack?.channelId || i.name;
};

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

const OFF_DIGEST_STATE: ResolvedSlackDigest = {
  frequency: "off",
  hourUtc: DEFAULT_SLACK_DIGEST_HOUR_UTC,
  dayOfWeekUtc: 1,
  dayOfMonth: 1,
  intervalDays: DEFAULT_SLACK_DIGEST_INTERVAL_DAYS,
};

// A subject's scheduled-digest sub-section: an enable toggle + cadence/time
// controls, separated from the events row above by a divider. Embedded inside
// the Experiments / Feature flags subject card.
function DigestSubSection({
  description,
  value,
  onChange,
}: {
  description: string;
  value: ResolvedSlackDigest;
  onChange: (next: ResolvedSlackDigest) => void;
}) {
  const enabled = value.frequency !== "off";
  return (
    <Box mt="4" pt="4" style={{ borderTop: "1px solid var(--gray-a4)" }}>
      <Switch
        label="Scheduled digest"
        description={description}
        value={enabled}
        onChange={(v) =>
          onChange({ ...value, frequency: v ? "weekly" : "off" })
        }
      />

      {enabled && (
        <Flex direction="column" gap="4" mt="4" style={{ maxWidth: 420 }}>
          <Select
            size="2"
            label="Frequency"
            value={value.frequency}
            setValue={(v) =>
              onChange({ ...value, frequency: v as SlackDigestFrequency })
            }
          >
            {slackDigestFrequencies
              .filter((f) => f !== "off")
              .map((f) => (
                <SelectItem key={f} value={f}>
                  {FREQUENCY_LABELS[f]}
                </SelectItem>
              ))}
          </Select>

          {value.frequency === "weekly" && (
            <Select
              size="2"
              label="Day of week"
              value={`${value.dayOfWeekUtc}`}
              setValue={(v) => onChange({ ...value, dayOfWeekUtc: Number(v) })}
            >
              {DAY_OF_WEEK_LABELS.map((label, i) => (
                <SelectItem key={i} value={`${i}`}>
                  {label}
                </SelectItem>
              ))}
            </Select>
          )}

          {(value.frequency === "monthly" ||
            value.frequency === "quarterly") && (
            <Select
              size="2"
              label="Day of month"
              value={`${value.dayOfMonth}`}
              setValue={(v) => onChange({ ...value, dayOfMonth: Number(v) })}
            >
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <SelectItem key={d} value={`${d}`}>
                  {d}
                </SelectItem>
              ))}
            </Select>
          )}

          {value.frequency === "custom" && (
            <Select
              size="2"
              label="Every"
              value={`${value.intervalDays}`}
              setValue={(v) => onChange({ ...value, intervalDays: Number(v) })}
            >
              {[2, 3, 5, 7, 10, 14, 21, 30, 45, 60, 90].map((d) => (
                <SelectItem key={d} value={`${d}`}>
                  {`${d} days`}
                </SelectItem>
              ))}
            </Select>
          )}

          <Select
            size="2"
            label="Time (UTC)"
            value={`${value.hourUtc}`}
            setValue={(v) => onChange({ ...value, hourUtc: Number(v) })}
          >
            {HOURS.map((h) => (
              <SelectItem key={h} value={`${h}`}>
                {`${h.toString().padStart(2, "0")}:00`}
              </SelectItem>
            ))}
          </Select>

          {value.frequency === "quarterly" && (
            <Callout status="info" mb="0">
              Delivered on your chosen day in January, April, July, and October.
            </Callout>
          )}
        </Flex>
      )}
    </Box>
  );
}

const parseCsvList = (value: string): string[] =>
  value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const SlackIntegrationDetailPage = () => {
  const router = useRouter();
  const { apiCall } = useAuth();
  const permissionsUtils = usePermissionsUtil();
  const environments = useEnvironments().map((env) => env.id);
  const { projects, tags } = useDefinitions();
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
  const [experimentDigest, setExperimentDigest] =
    useState<ResolvedSlackDigest>(OFF_DIGEST_STATE);
  const [featureDigest, setFeatureDigest] =
    useState<ResolvedSlackDigest>(OFF_DIGEST_STATE);
  const [showAdvanced, setShowAdvanced] = useState<Set<SlackEventCategory>>(
    new Set(),
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  // Optional delivery filters (empty array = no filter = all).
  const [filterProjects, setFilterProjects] = useState<string[]>([]);
  const [filterEnvironments, setFilterEnvironments] = useState<string[]>([]);
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [filterExperiments, setFilterExperiments] = useState<string[]>([]);
  const [filterMetrics, setFilterMetrics] = useState<string[]>([]);
  // Tag / experiment / metric filters live behind a "more" toggle; auto-open
  // when any are already set.
  const [showMoreFilters, setShowMoreFilters] = useState(false);

  // Hydrate form when the integration loads.
  useEffect(() => {
    if (!integration) return;
    // A legacy install still carrying wildcard subscriptions (e.g. "feature.*")
    // is effectively unconfigured — its wildcard matches every event in the
    // resource, which would read as "everything selected" and falsely flag the
    // category as Customized. Present it as the recommended defaults instead;
    // saving then migrates it to an explicit curated list.
    const hasWildcards = integration.events.some(isEventWebhookWildcard);
    setSelected(
      hasWildcards
        ? defaultSlackOptionIds()
        : selectedSlackOptionIds(integration.events),
    );
    setCardFormat(integration.slackOptions?.experimentCardFormat ?? "compact");
    setExperimentDigest(
      resolveExperimentDigest(integration.slackOptions, {
        dailyDigestHourUtc: integration.dailyDigestHourUtc,
      }),
    );
    setFeatureDigest(resolveFeatureDigest(integration.slackOptions));
    setFilterProjects(integration.projects || []);
    setFilterEnvironments(integration.environments || []);
    setFilterTags(integration.tags || []);
    setFilterExperiments(integration.experiments || []);
    setFilterMetrics(integration.metrics || []);
    setShowMoreFilters(
      (integration.tags?.length || 0) +
        (integration.experiments?.length || 0) +
        (integration.metrics?.length || 0) >
        0,
    );
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

  // Whether a category's selection deviates from its recommended defaults —
  // only meaningful when the category is on (an off category reads as off, not
  // "customized").
  const categoryCustomized = (category: SlackEventCategory) => {
    const opts = SLACK_EVENT_OPTIONS.filter((o) => o.category === category);
    return opts.some((o) => selected.has(o.id) !== o.defaultOn);
  };

  const resetCategory = (category: SlackEventCategory) => {
    setSelected((prev) => {
      const next = new Set(prev);
      SLACK_EVENT_OPTIONS.forEach((o) => {
        if (o.category !== category) return;
        if (o.defaultOn) next.add(o.id);
        else next.delete(o.id);
      });
      return next;
    });
    setSaved(false);
  };

  const toggleAdvanced = (category: SlackEventCategory) =>
    setShowAdvanced((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });

  // The "Event notifications" row (toggle + customized/reset/customize) and its
  // expandable per-event grid, for one subject.
  const categoryEventsBlock = (category: SlackEventCategory) => {
    const enabled = categoryEnabled(category);
    const advancedOpen = showAdvanced.has(category);
    const isCustom = enabled && categoryCustomized(category);
    return (
      <Box>
        <Flex justify="between" align="start" gap="3">
          <Switch
            label={
              <Flex asChild align="center" gap="2">
                <span>
                  Event notifications
                  {isCustom && (
                    <Badge
                      label="Customized"
                      color="gray"
                      variant="soft"
                      title="Events differ from the recommended defaults"
                    />
                  )}
                </span>
              </Flex>
            }
            description={SUBJECT_META[category].events}
            value={enabled}
            onChange={(v) => setCategoryEnabled(category, v)}
          />
          <Flex align="center" gap="2" style={{ flexShrink: 0 }}>
            {isCustom && (
              <Button
                variant="ghost"
                color="gray"
                size="xs"
                onClick={() => resetCategory(category)}
              >
                Reset
              </Button>
            )}
            <Button
              variant="ghost"
              color="gray"
              size="xs"
              onClick={() => toggleAdvanced(category)}
            >
              {advancedOpen ? "Hide events" : "Customize events"}
            </Button>
          </Flex>
        </Flex>

        {advancedOpen && (
          <Box mt="4">
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
                  <Grid columns={{ initial: "1", sm: "2" }} gapX="4" gapY="3">
                    {SLACK_EVENT_OPTIONS.filter(
                      (o) => o.category === category && o.group === group,
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
  };

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

      const digestConfig = (d: ResolvedSlackDigest) =>
        d.frequency === "off"
          ? { frequency: d.frequency }
          : {
              frequency: d.frequency,
              hourUtc: d.hourUtc,
              ...(d.frequency === "weekly"
                ? { dayOfWeekUtc: d.dayOfWeekUtc }
                : {}),
              ...(d.frequency === "monthly" || d.frequency === "quarterly"
                ? { dayOfMonth: d.dayOfMonth }
                : {}),
              ...(d.frequency === "custom"
                ? { intervalDays: d.intervalDays }
                : {}),
            };

      await apiCall(`/event-webhooks/${integration.eventWebHookId}`, {
        method: "PUT",
        body: JSON.stringify({
          events,
          projects: filterProjects,
          environments: filterEnvironments,
          tags: filterTags,
          experiments: filterExperiments,
          metrics: filterMetrics,
          slackOptions: {
            experimentCardFormat: cardFormat,
            experimentDigest: digestConfig(experimentDigest),
            featureDigest: digestConfig(featureDigest),
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

  const reconnect = async () => {
    setReconnecting(true);
    try {
      const res = await apiCall<{ url: string }>(
        "/integrations/slack/connect",
        { method: "POST" },
      );
      window.location.href = res.url;
    } catch (e) {
      setSaveError(
        e instanceof Error ? e.message : "Failed to start reconnect.",
      );
      setReconnecting(false);
    }
  };

  if (!permissionsUtils.canManageIntegrations()) {
    return (
      <div className="container pagecontents">
        <Callout status="error">
          You do not have access to view this page.
        </Callout>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container pagecontents">
        <Callout status="error">
          Failed to load Slack integrations: {error.message}
        </Callout>
      </div>
    );
  }

  if (!data) return <LoadingOverlay />;

  if (!integration) {
    return (
      <div className="container pagecontents">
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
  // Installs connected before the channels:read/groups:read scopes were added
  // can't resolve live channel names (or use future scope-gated features).
  const grantedScopes = (integration.slack?.scope || "")
    .split(",")
    .map((s) => s.trim());
  const needsReconnect = REQUIRED_SCOPES.some(
    (s) => !grantedScopes.includes(s),
  );

  return (
    <div className="container pagecontents">
      <PageHead
        breadcrumb={[
          { display: "Slack", href: "/integrations/slack" },
          { display: getChannelLabel(integration) },
        ]}
      />

      <Flex direction="column" gap="4">
        <Box>
          <Heading as="h1" size="large" mb="1">
            {getChannelLabel(integration)}
          </Heading>
          <Text color="text-mid">{getWorkspaceLabel(integration)}</Text>
        </Box>

        {needsReconnect && (
          <Callout status="warning">
            <Flex justify="between" align="center" gap="3" wrap="wrap">
              <Text>
                This channel was connected before newer Slack permissions were
                added. Reconnect to enable live channel names and other recent
                features.
              </Text>
              <Button onClick={reconnect} loading={reconnecting}>
                Reconnect
              </Button>
            </Flex>
          </Callout>
        )}

        {/* Scope */}
        <Frame>
          <Heading as="h2" size="small" mb="1">
            Scope
          </Heading>
          <Text as="p" color="text-mid" mb="4">
            Limit what this channel hears. Leave a filter empty to include
            everything; non-empty filters combine.
          </Text>

          <Box style={{ maxWidth: 560 }}>
            <Grid columns={{ initial: "1", sm: "2" }} gapX="4" gapY="4">
              <MultiSelectField
                label="Projects"
                placeholder="All projects"
                value={filterProjects}
                options={projects.map(({ id: pid, name }) => ({
                  label: name,
                  value: pid,
                }))}
                onChange={(v) => {
                  setFilterProjects(v);
                  setSaved(false);
                }}
              />

              <MultiSelectField
                label="Environments"
                placeholder="All environments"
                value={filterEnvironments}
                options={environments.map((env) => ({
                  label: env,
                  value: env,
                }))}
                onChange={(v) => {
                  setFilterEnvironments(v);
                  setSaved(false);
                }}
              />
            </Grid>

            {!showMoreFilters ? (
              <Box mt="3">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setShowMoreFilters(true)}
                >
                  + Add tag, experiment or metric filter
                </Button>
              </Box>
            ) : (
              <Flex direction="column" gap="4" mt="4">
                <Box>
                  <Text as="label" size="medium" weight="medium">
                    Tags
                  </Text>
                  <TagsInput
                    tagOptions={tags}
                    value={filterTags}
                    onChange={(v) => {
                      setFilterTags(v);
                      setSaved(false);
                    }}
                  />
                </Box>

                <Field
                  label="Experiments"
                  placeholder="exp_123, exp_456"
                  helpText="Comma-separated experiment IDs. Empty = all."
                  value={filterExperiments.join(", ")}
                  onChange={(e) => {
                    setFilterExperiments(parseCsvList(e.target.value));
                    setSaved(false);
                  }}
                />

                <Field
                  label="Metrics"
                  placeholder="met_123, met_456"
                  helpText="Comma-separated metric IDs. Empty = all."
                  value={filterMetrics.join(", ")}
                  onChange={(e) => {
                    setFilterMetrics(parseCsvList(e.target.value));
                    setSaved(false);
                  }}
                />
              </Flex>
            )}
          </Box>
        </Frame>

        {/* Subject sections — each owns its event notifications + digest. */}
        {(["experiment", "feature"] as SlackEventCategory[]).map((category) => (
          <Frame key={category}>
            <Heading as="h2" size="small" mb="1">
              {SUBJECT_META[category].heading}
            </Heading>
            <Text as="p" color="text-mid" mb="4">
              {SUBJECT_META[category].description}
            </Text>

            {categoryEventsBlock(category)}

            <DigestSubSection
              description={SUBJECT_META[category].digest}
              value={
                category === "experiment" ? experimentDigest : featureDigest
              }
              onChange={(next) => {
                if (category === "experiment") setExperimentDigest(next);
                else setFeatureDigest(next);
                setSaved(false);
              }}
            />
          </Frame>
        ))}

        {noneSelected && (
          <Callout status="warning">
            No events selected — this channel won&rsquo;t receive live
            notifications.
          </Callout>
        )}

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
              size="2"
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

        {/* Sticky action bar so Save stays reachable while scrolling. */}
        <Box
          style={{
            position: "sticky",
            bottom: 0,
            zIndex: 1,
            marginTop: "var(--space-2)",
            paddingTop: "var(--space-3)",
            paddingBottom: "var(--space-3)",
            borderTop: "1px solid var(--gray-a5)",
            background: "var(--color-background)",
          }}
        >
          <Flex gap="3" align="center">
            <Button onClick={save} loading={saving}>
              Save settings
            </Button>
            {saved && (
              <Text color="text-mid" size="small">
                Saved.
              </Text>
            )}
            {saveError && <HelperText status="error">{saveError}</HelperText>}
          </Flex>
        </Box>
      </Flex>
    </div>
  );
};

export default SlackIntegrationDetailPage;
