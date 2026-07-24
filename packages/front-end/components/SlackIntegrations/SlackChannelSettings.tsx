import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { SlackOAuthIntegrationInterface } from "shared/types/slack-integration";
import { ago } from "shared/dates";
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
  slackCardKindForEvent,
  DEFAULT_SLACK_DIGEST_HOUR_UTC,
  DEFAULT_SLACK_DIGEST_INTERVAL_DAYS,
  type SlackDigestFrequency,
  type SlackCardKind,
  type ResolvedSlackDigest,
} from "shared/validators";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { PiTrash, PiPaperPlaneTilt, PiX } from "react-icons/pi";
import { useExperiments } from "@/hooks/useExperiments";
import { useFeaturesList, useEnvironments } from "@/services/features";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import MultiSelectField from "@/ui/MultiSelectField";
import TagsInput from "@/components/Tags/TagsInput";
import SlackMessagePreview from "@/components/SlackIntegrations/SlackMessagePreview";
import Frame from "@/ui/Frame";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import HelperText from "@/ui/HelperText";
import Switch from "@/ui/Switch";
import Checkbox from "@/ui/Checkbox";
import ConfirmDialog from "@/ui/ConfirmDialog";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { Select, SelectItem, SelectGroup, SelectLabel } from "@/ui/Select";

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

// Per-subject UI copy (each subject owns its event notifications + digest).
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

const CATEGORY_LABEL: Record<SlackEventCategory, string> = {
  experiment: "Experiments",
  feature: "Feature flags",
};

// Card kind → sample chart-preview params (snapshot state + compact event) so
// the preview renders the right hero for each card event.
const CARD_KIND_PREVIEW: Record<
  SlackCardKind,
  { state: string; event: string }
> = {
  started: { state: "started", event: "started" },
  significance: { state: "running", event: "significance" },
  won: { state: "winner", event: "won" },
  lost: { state: "loser", event: "lost" },
  stopped: { state: "stopped", event: "stopped" },
  warning: { state: "warning", event: "warning" },
  // Decision recommendations preview like significance (running + lift), using
  // a positive sample for ship and a negative one for rollback.
  decisionShip: { state: "winner", event: "decisionShip" },
  decisionRollback: { state: "loser", event: "decisionRollback" },
};

// A catalog option "posts a card" if any of its events renders a results card
// (only experiment result/decision/health events do). Marked in the customize
// list so it's clear which events post an image vs plain text.
const optionPostsCard = (o: (typeof SLACK_EVENT_OPTIONS)[number]): boolean =>
  o.events.some((e) => !!slackCardKindForEvent(e));

const CARD_MARKER = "▪";

// Digests aren't events — they're sentinel picker values that render a sample
// scorecard / feature-flag summary image (always an image, so tagged as such).
const digestKindForValue = (value: string): "scorecard" | "feature" | null =>
  value === "digest:scorecard"
    ? "scorecard"
    : value === "digest:feature"
      ? "feature"
      : null;

// Events + digests offered in the test-send + preview pickers, grouped like the
// catalog. For events, value = the catalog option's representative event (all
// are valid test events); the two digests are appended as their own group.
type PreviewEventOption = {
  value: string;
  label: string;
  tag: "card" | "text" | "image";
};
const PREVIEW_EVENT_GROUPS: {
  key: string;
  heading: string;
  items: PreviewEventOption[];
}[] = (() => {
  const groups: {
    key: string;
    heading: string;
    items: PreviewEventOption[];
  }[] = [];
  SLACK_EVENT_OPTIONS.forEach((o) => {
    const event = o.events[0];
    if (!event) return;
    const key = `${o.category}:${o.group}`;
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = {
        key,
        heading: `${CATEGORY_LABEL[o.category]} · ${o.group}`,
        items: [],
      };
      groups.push(g);
    }
    g.items.push({
      value: event,
      label: o.label,
      tag: slackCardKindForEvent(event) ? "card" : "text",
    });
  });
  groups.push({
    key: "digests",
    heading: "Digests",
    items: [
      {
        value: "digest:scorecard",
        label: "Experiment scorecard",
        tag: "image",
      },
      { value: "digest:feature", label: "Feature-flag digest", tag: "image" },
    ],
  });
  return groups;
})();

const DEFAULT_PREVIEW_EVENT = "experiment.info.significance";

// Grouped picker shared by the send-test modal and the preview area. Each item
// is tagged (card) / (text) / (image) so it's clear what it posts.
function EventSelect({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  return (
    <Select size="small" label={label} value={value} setValue={onChange}>
      {PREVIEW_EVENT_GROUPS.map((g) => (
        <SelectGroup key={g.key}>
          <SelectLabel>{g.heading}</SelectLabel>
          {g.items.map((it) => (
            <SelectItem key={it.value} value={it.value}>
              {it.label} ({it.tag})
            </SelectItem>
          ))}
        </SelectGroup>
      ))}
    </Select>
  );
}

// Scopes a CHANNEL connection needs (channels:join is workspace-level — see
// the index page). Missing any → reconnect prompt; a workspace reconnect
// propagates the fresh scope string to channel docs. Subset of
// SLACK_OAUTH_SCOPE (back-end slackIntegration.ts).
const REQUIRED_SCOPES = ["channels:read", "groups:read"];

export const getSlackChannelLabel = (i: SlackOAuthIntegrationInterface) => {
  const name = i.slack?.channelName;
  // Prefix the resolved name with "#" (once) so it reads like Slack; leave the
  // channel-id / webhook-name fallbacks as-is.
  if (name) return name.startsWith("#") ? name : `#${name}`;
  return i.slack?.channelId || i.name;
};

export const getSlackWorkspaceLabel = (i: SlackOAuthIntegrationInterface) =>
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

// Left indent that aligns content under a Switch's label — the switch track
// (~28px) plus the Switch's gapX ("space-2", 8px).
const SWITCH_LABEL_INDENT = "calc(28px + var(--space-2))";

const OFF_DIGEST_STATE: ResolvedSlackDigest = {
  frequency: "off",
  hourUtc: DEFAULT_SLACK_DIGEST_HOUR_UTC,
  dayOfWeekUtc: 1,
  dayOfMonth: 1,
  intervalDays: DEFAULT_SLACK_DIGEST_INTERVAL_DAYS,
};

// A subject's scheduled-digest sub-section (enable toggle + cadence/time),
// embedded in the Experiments / Feature flags subject card.
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
        <Box mt="4" style={{ maxWidth: 560, paddingLeft: SWITCH_LABEL_INDENT }}>
          {/* Frequency + (day/interval) + time laid out in columns: 3 when a
              day/interval select is present, 2 for daily. */}
          <Grid
            columns={{
              initial: "1",
              sm: value.frequency === "daily" ? "2" : "3",
            }}
            gapX="4"
            gapY="4"
          >
            <Select
              size="small"
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
                size="small"
                label="Day of week"
                value={`${value.dayOfWeekUtc}`}
                setValue={(v) =>
                  onChange({ ...value, dayOfWeekUtc: Number(v) })
                }
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
                size="small"
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
                size="small"
                label="Every"
                value={`${value.intervalDays}`}
                setValue={(v) =>
                  onChange({ ...value, intervalDays: Number(v) })
                }
              >
                {[2, 3, 5, 7, 10, 14, 21, 30, 45, 60, 90].map((d) => (
                  <SelectItem key={d} value={`${d}`}>
                    {`${d} days`}
                  </SelectItem>
                ))}
              </Select>
            )}

            <Select
              size="small"
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
          </Grid>

          <Text as="p" size="small" color="text-mid" mt="2" mb="0">
            Scheduled in UTC.
          </Text>

          {value.frequency === "quarterly" && (
            <Callout status="info" mb="0" mt="4">
              Delivered on your chosen day in January, April, July, and October.
            </Callout>
          )}
        </Box>
      )}
    </Box>
  );
}

// Live preview of what a given selection posts: a sample digest image, the
// real results card (via the card renderer) for card events, or the real text
// message (via the previews endpoint) for everything else. Card events only
// render an image when a card style is selected; otherwise they fall back to
// their text message too.
function EventPreview({
  eventName,
  style,
}: {
  eventName: string;
  style: (typeof experimentCardFormats)[number];
}) {
  const { apiCall } = useAuth();
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const digestKind = digestKindForValue(eventName);
  const cardKind = slackCardKindForEvent(eventName);
  // The image to fetch, if any. Digests are always images; card events only
  // when a card style is selected. Otherwise there's no image (text preview).
  const imageSrc = digestKind
    ? `/admin/slack-test/chart-preview?digest=${digestKind}`
    : cardKind && style !== "none"
      ? `/admin/slack-test/chart-preview?style=${
          style === "compact" ? "compact" : "detailed"
        }&state=${CARD_KIND_PREVIEW[cardKind].state}&event=${
          CARD_KIND_PREVIEW[cardKind].event
        }`
      : null;

  useEffect(() => {
    if (!imageSrc) {
      setUrl(null);
      setErr(null);
      return;
    }
    let objectUrl: string | null = null;
    let cancelled = false;
    setUrl(null);
    setErr(null);
    (async () => {
      try {
        const blob = await apiCall<Blob>(imageSrc);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : "Couldn't render preview.");
        }
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [imageSrc, apiCall]);

  if (!imageSrc) {
    return (
      <>
        <Text as="p" color="text-mid" size="small" mb="2">
          {cardKind
            ? "Card style is off — this event posts a text-only message. Example:"
            : "This event posts a text message (no card). Example:"}
        </Text>
        <SlackMessagePreview eventName={eventName} />
      </>
    );
  }
  if (err) return <HelperText status="error">{err}</HelperText>;
  if (!url) {
    return (
      <Text as="p" color="text-mid" size="small" mb="0">
        Rendering preview…
      </Text>
    );
  }
  return (
    <img
      src={url}
      alt={digestKind ? "Digest preview" : "Results card preview"}
      style={{
        display: "block",
        width: "100%",
        maxWidth: digestKind ? 560 : style === "compact" ? 460 : 520,
        borderRadius: 10,
        boxShadow: "0 6px 20px -6px rgba(0,0,0,.35)",
      }}
    />
  );
}

/**
 * The full settings editor for one connected Slack channel, embedded as the
 * detail pane of the single Slack settings page: header (name, enabled toggle,
 * send test, delete), Scope / Experiments / Feature flags / Results card
 * sections, and a sticky save bar with an unsaved-changes indicator.
 */
export default function SlackChannelSettings({
  integration,
  onSaved,
  onDeleted,
  saveBarHost,
  saveBarInsetLeft,
}: {
  integration: SlackOAuthIntegrationInterface;
  /** Called after a successful save (parent revalidates its list). */
  onSaved: () => Promise<void>;
  /** Called after a successful delete (parent revalidates + reselects). */
  onDeleted: () => Promise<void>;
  /**
   * Element to portal the sticky save bar into — a full-width slot at the
   * bottom of the page card. Without it the bar renders inline at the bottom
   * of the form.
   */
  saveBarHost?: HTMLElement | null;
  /** Left padding for the portaled bar (aligns Save with the detail column). */
  saveBarInsetLeft?: string;
}) {
  const { apiCall } = useAuth();
  const environments = useEnvironments().map((env) => env.id);
  const { projects, tags, metrics, factMetrics } = useDefinitions();
  const { experiments } = useExperiments();
  const { features } = useFeaturesList();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [enabled, setEnabled] = useState(true);
  const [cardFormat, setCardFormat] =
    useState<(typeof experimentCardFormats)[number]>("compact");
  // Event shown in the results-card preview.
  const [previewEvent, setPreviewEvent] = useState<string>(
    DEFAULT_PREVIEW_EVENT,
  );
  // Send-test modal: whether it's open and which event it will post.
  const [showSendTest, setShowSendTest] = useState(false);
  const [testEvent, setTestEvent] = useState<string>(DEFAULT_PREVIEW_EVENT);
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
  // Any edit marks the form dirty; save (or rehydration) clears it. Drives the
  // amber unsaved-changes indicator and disables Save when clean.
  const [dirty, setDirty] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  // Optional delivery filters (empty array = no filter = all).
  const [filterProjects, setFilterProjects] = useState<string[]>([]);
  const [filterEnvironments, setFilterEnvironments] = useState<string[]>([]);
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [filterExperiments, setFilterExperiments] = useState<string[]>([]);
  const [filterMetrics, setFilterMetrics] = useState<string[]>([]);
  const [filterFeatures, setFilterFeatures] = useState<string[]>([]);
  // Tag / experiment / metric / feature filters live behind a "more" toggle;
  // auto-open when any are already set.
  const [showMoreFilters, setShowMoreFilters] = useState(false);

  const markDirty = () => {
    setDirty(true);
    setSaved(false);
  };

  // Options for the searchable experiment/metric filters — human-readable names
  // keyed by id. A previously-saved id that's since been archived/deleted (or
  // out of the current project scope) won't be in the list, so keep it as a
  // fallback option labeled by id rather than silently dropping it on save.
  const experimentOptions = useMemo(() => {
    const opts = experiments.map((e) => ({ label: e.name, value: e.id }));
    const known = new Set(opts.map((o) => o.value));
    return opts.concat(
      filterExperiments
        .filter((id) => !known.has(id))
        .map((id) => ({ label: id, value: id })),
    );
  }, [experiments, filterExperiments]);

  const metricOptions = useMemo(() => {
    const opts = [...metrics, ...factMetrics].map((m) => ({
      label: m.name,
      value: m.id,
    }));
    const known = new Set(opts.map((o) => o.value));
    return opts.concat(
      filterMetrics
        .filter((id) => !known.has(id))
        .map((id) => ({ label: id, value: id })),
    );
  }, [metrics, factMetrics, filterMetrics]);

  const featureOptions = useMemo(() => {
    const opts = features.map((f) => ({ label: f.id, value: f.id }));
    const known = new Set(opts.map((o) => o.value));
    return opts.concat(
      filterFeatures
        .filter((id) => !known.has(id))
        .map((id) => ({ label: id, value: id })),
    );
  }, [features, filterFeatures]);

  // Hydrate form when the integration loads/changes.
  useEffect(() => {
    if (!integration) return;
    // A legacy install carrying wildcard subscriptions (e.g. "feature.*") is
    // effectively unconfigured — the wildcard matches everything and would
    // falsely read as "Customized". Show the recommended defaults instead;
    // saving migrates it to an explicit curated list.
    const hasWildcards = integration.events.some(isEventWebhookWildcard);
    setSelected(
      hasWildcards
        ? defaultSlackOptionIds()
        : selectedSlackOptionIds(integration.events),
    );
    setEnabled(integration.enabled);
    setCardFormat(integration.slackOptions?.experimentCardFormat ?? "compact");
    setExperimentDigest(resolveExperimentDigest(integration.slackOptions));
    setFeatureDigest(resolveFeatureDigest(integration.slackOptions));
    setFilterProjects(integration.projects || []);
    setFilterEnvironments(integration.environments || []);
    setFilterTags(integration.tags || []);
    setFilterExperiments(integration.experiments || []);
    setFilterMetrics(integration.metrics || []);
    setFilterFeatures(integration.features || []);
    setShowMoreFilters(
      (integration.tags?.length || 0) +
        (integration.experiments?.length || 0) +
        (integration.metrics?.length || 0) +
        (integration.features?.length || 0) >
        0,
    );
    setDirty(false);
  }, [integration]);

  // Auto-dismiss the "test sent" confirmation after a few seconds (it's a
  // transient toast, not a persistent state). Each new send resets the timer.
  useEffect(() => {
    if (!testResult) return;
    const timer = setTimeout(() => setTestResult(null), 6000);
    return () => clearTimeout(timer);
  }, [testResult]);

  const setOptionSelected = (optionId: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(optionId);
      else next.delete(optionId);
      return next;
    });
    markDirty();
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
    markDirty();
  };

  const categoryEnabled = (category: SlackEventCategory) =>
    SLACK_EVENT_OPTIONS.some(
      (o) => o.category === category && selected.has(o.id),
    );

  // Whether a category's selection deviates from its defaults. Only meaningful
  // when the category is on (an off category reads as off, not "customized").
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
    markDirty();
  };

  const toggleAdvanced = (category: SlackEventCategory) =>
    setShowAdvanced((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });

  // The "Event notifications" row and its expandable per-event grid, for one subject.
  const categoryEventsBlock = (category: SlackEventCategory) => {
    const catEnabled = categoryEnabled(category);
    const advancedOpen = showAdvanced.has(category);
    const isCustom = catEnabled && categoryCustomized(category);
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
            value={catEnabled}
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
          <Box mt="4" style={{ paddingLeft: SWITCH_LABEL_INDENT }}>
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
                        label={
                          optionPostsCard(o) ? (
                            <>
                              {o.label}
                              <span
                                title="Posts a results card"
                                style={{
                                  marginLeft: 5,
                                  color: "var(--violet-11)",
                                }}
                              >
                                {CARD_MARKER}
                              </span>
                            </>
                          ) : (
                            o.label
                          )
                        }
                        description={o.description}
                        value={selected.has(o.id)}
                        setValue={(v) => setOptionSelected(o.id, v)}
                      />
                    ))}
                  </Grid>
                </Box>
              ))}

              {SLACK_EVENT_OPTIONS.some(
                (o) => o.category === category && optionPostsCard(o),
              ) && (
                <Text size="small" color="text-mid" as="div">
                  <span style={{ color: "var(--violet-11)" }}>
                    {CARD_MARKER}
                  </span>{" "}
                  Posts a results-card image (when a card style is set); others
                  post a text message.
                </Text>
              )}
            </Flex>
          </Box>
        )}
      </Box>
    );
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const selectedEvents = SLACK_EVENT_OPTIONS.filter((o) =>
        selected.has(o.id),
      ).flatMap((o) => o.events);
      // Preserve explicit (non-wildcard) subscriptions not in the Slack catalog;
      // wildcards are dropped (already converted to explicit selections above).
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
          enabled,
          events,
          projects: filterProjects,
          environments: filterEnvironments,
          tags: filterTags,
          experiments: filterExperiments,
          metrics: filterMetrics,
          features: filterFeatures,
          slackOptions: {
            experimentCardFormat: cardFormat,
            experimentDigest: digestConfig(experimentDigest),
            featureDigest: digestConfig(featureDigest),
          },
        }),
      });
      await onSaved();
      setSaved(true);
      setDirty(false);
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

  const handleDelete = async () => {
    await apiCall(`/integrations/slack/${integration.id}`, {
      method: "DELETE",
    });
    await onDeleted();
  };

  // Posts the selected event to Slack. Throws on failure so the modal keeps it
  // open and shows the error; on success the modal closes and the outcome shows
  // in the pane-level callout.
  const sendTest = async () => {
    setTestResult(null);
    const digestKind = digestKindForValue(testEvent);
    const res = await apiCall<{ ok: boolean; error?: string }>(
      "/admin/slack-test/event-webhook",
      {
        method: "POST",
        body: JSON.stringify(
          digestKind
            ? { eventWebHookId: integration.eventWebHookId, digest: digestKind }
            : {
                eventWebHookId: integration.eventWebHookId,
                eventName: testEvent,
              },
        ),
      },
    );
    if (!res.ok) throw new Error(res.error || "Failed to send test message.");
    const kindWord = digestKind
      ? "digest"
      : slackCardKindForEvent(testEvent) && cardFormat !== "none"
        ? "card"
        : "message";
    setTestResult({
      ok: true,
      message: `Test ${kindWord} sent to ${getSlackChannelLabel(integration)}.`,
    });
  };

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
    <>
      {confirmingDelete && (
        <ConfirmDialog
          title="Delete Slack channel connection?"
          content={`${getSlackChannelLabel(
            integration,
          )} will stop receiving GrowthBook notifications and its digests. This can't be undone, though you can create another connection.`}
          yesText="Delete"
          onConfirm={handleDelete}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}

      {showSendTest && (
        <ModalStandard
          trackingEventModalType="slack-send-test-message"
          open={showSendTest}
          header="Send a test message"
          cta={`Send to ${getSlackChannelLabel(integration)}`}
          submit={sendTest}
          close={() => setShowSendTest(false)}
        >
          <Text as="p" color="text-mid" mb="3">
            Posts a sample notification to {getSlackChannelLabel(integration)}{" "}
            so you can see how it looks. Pick what to send — <em>(card)</em>{" "}
            posts a results card, <em>(image)</em> posts a digest, the rest post
            text.
          </Text>
          <Box mb="4">
            <EventSelect
              label="Message type"
              value={testEvent}
              onChange={setTestEvent}
            />
          </Box>
          <Text size="small" weight="medium" color="text-mid" as="div" mb="2">
            Preview
          </Text>
          <EventPreview eventName={testEvent} style={cardFormat} />
        </ModalStandard>
      )}

      <Flex direction="column" gap="4">
        {/* Detail header: channel identity + per-channel actions. */}
        <Flex justify="between" align="start" gap="3" wrap="wrap">
          <Box>
            <Heading as="h2" size="medium" mb="0">
              {getSlackChannelLabel(integration)}
            </Heading>
            <Text color="text-mid" size="small">
              {getSlackWorkspaceLabel(integration)}
              {integration.lastRunAt
                ? ` · last run ${ago(integration.lastRunAt)}`
                : " · no runs yet"}
            </Text>
          </Box>
          <Flex gap="3" align="center" style={{ flexShrink: 0 }}>
            <Switch
              label="Enabled"
              value={enabled}
              onChange={(v) => {
                setEnabled(v);
                markDirty();
              }}
            />
            <Box
              style={{
                width: 1,
                height: 22,
                background: "var(--gray-a5)",
              }}
            />
            <Button
              variant="outline"
              color="gray"
              icon={<PiPaperPlaneTilt />}
              onClick={() => {
                setTestEvent(previewEvent);
                setShowSendTest(true);
              }}
            >
              Send test message
            </Button>
            <Button
              variant="outline"
              color="red"
              icon={<PiTrash />}
              onClick={() => setConfirmingDelete(true)}
            >
              Delete
            </Button>
          </Flex>
        </Flex>

        {testResult && (
          <Callout status={testResult.ok ? "success" : "error"}>
            <Flex align="center" justify="between" gap="3">
              <span>{testResult.message}</span>
              <Button
                variant="ghost"
                color="gray"
                size="xs"
                aria-label="Dismiss"
                onClick={() => setTestResult(null)}
              >
                <PiX />
              </Button>
            </Flex>
          </Callout>
        )}

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
        <Frame mb="0">
          <Heading as="h3" size="small" mb="1">
            Scope
          </Heading>
          <Text as="p" color="text-mid" mb="4">
            Limit what this channel hears. Leave a filter empty to include
            everything; non-empty filters combine.
          </Text>

          <Box style={{ maxWidth: 800 }}>
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
                  markDirty();
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
                  markDirty();
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
                  + Add tag, experiment, metric or feature filter
                </Button>
              </Box>
            ) : (
              <Box mt="4">
                <Grid columns={{ initial: "1", sm: "2" }} gapX="4" gapY="4">
                  <Box>
                    <Text as="label" size="medium" weight="medium">
                      Tags
                    </Text>
                    <TagsInput
                      tagOptions={tags}
                      value={filterTags}
                      onChange={(v) => {
                        setFilterTags(v);
                        markDirty();
                      }}
                    />
                  </Box>

                  <MultiSelectField
                    label="Experiments"
                    placeholder="All experiments"
                    value={filterExperiments}
                    options={experimentOptions}
                    onChange={(v) => {
                      setFilterExperiments(v);
                      markDirty();
                    }}
                  />

                  <MultiSelectField
                    label="Metrics"
                    placeholder="All metrics"
                    value={filterMetrics}
                    options={metricOptions}
                    onChange={(v) => {
                      setFilterMetrics(v);
                      markDirty();
                    }}
                  />

                  <MultiSelectField
                    label="Features"
                    placeholder="All feature flags"
                    value={filterFeatures}
                    options={featureOptions}
                    onChange={(v) => {
                      setFilterFeatures(v);
                      markDirty();
                    }}
                  />
                </Grid>

                {/* Collapsible again only while empty — hiding fields with
                    active values would hide what's actually filtering. */}
                {filterTags.length +
                  filterExperiments.length +
                  filterMetrics.length +
                  filterFeatures.length ===
                  0 && (
                  <Box mt="3">
                    <Button
                      variant="ghost"
                      color="gray"
                      size="xs"
                      onClick={() => setShowMoreFilters(false)}
                    >
                      − Hide these filters
                    </Button>
                  </Box>
                )}
              </Box>
            )}
          </Box>
        </Frame>

        {/* Subject sections — each owns its event notifications + digest. */}
        {(["experiment", "feature"] as SlackEventCategory[]).map((category) => (
          <Frame key={category} mb="0">
            <Heading as="h3" size="small" mb="1">
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
                markDirty();
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
        <Frame mb="0">
          <Heading as="h3" size="small" mb="1">
            Results card
          </Heading>
          <Text as="p" color="text-mid" mb="4">
            The image posted for experiment results (started, significance,
            won/lost, stopped, health).
          </Text>
          {/* Card style on the left; PREVIEW eyebrow + image + preview-event
              picker below it on the right (per the design handoff). */}
          <Flex gap="6" align="start" wrap="wrap">
            <Box style={{ flex: 1, minWidth: 220 }}>
              <Select
                size="small"
                label="Card style"
                value={cardFormat}
                setValue={(v) => {
                  setCardFormat(v as (typeof experimentCardFormats)[number]);
                  markDirty();
                }}
              >
                {experimentCardFormats.map((f) => (
                  <SelectItem key={f} value={f}>
                    {CARD_FORMAT_LABELS[f]}
                  </SelectItem>
                ))}
              </Select>
            </Box>

            <Box style={{ flex: "none", width: 460, maxWidth: "100%" }}>
              <Text
                as="div"
                size="small"
                weight="medium"
                color="text-mid"
                textTransform="uppercase"
                mb="2"
              >
                Preview
              </Text>
              <EventPreview eventName={previewEvent} style={cardFormat} />
              <Box mt="3">
                <EventSelect
                  label="Preview event"
                  value={previewEvent}
                  onChange={setPreviewEvent}
                />
                <Text as="p" size="small" color="text-mid" mt="1" mb="0">
                  Choose which event to preview — started, significance, won /
                  lost, stopped, health, or a digest.
                </Text>
              </Box>
            </Box>
          </Flex>
        </Frame>

        {/* Sticky save bar with an unsaved-changes indicator. Rendered into
            `saveBarHost` (a full-width slot at the bottom of the page card)
            when provided, so the bar spans the rail + detail columns while the
            save state stays local to this form. `saveBarInsetLeft` lines the
            button up with the detail column's left edge. */}
        {(() => {
          const bar = (
            <Box
              style={{
                // When portaled, stickiness comes from the host slot (its
                // parent is tall enough to stick within); inline fallback
                // sticks on its own.
                ...(saveBarHost
                  ? {}
                  : { position: "sticky", bottom: 0, zIndex: 1 }),
                padding: saveBarHost
                  ? `var(--space-3) var(--space-5)`
                  : "var(--space-3) 0",
                paddingLeft: saveBarHost
                  ? (saveBarInsetLeft ?? "var(--space-5)")
                  : 0,
                borderTop: "1px solid var(--gray-a5)",
                background: "var(--color-panel-solid)",
                // Match the appbox's rounded bottom corners.
                borderRadius: saveBarHost ? "0 0 5px 5px" : undefined,
              }}
            >
              <Flex gap="3" align="center">
                <Button onClick={save} loading={saving} disabled={!dirty}>
                  Save settings
                </Button>
                {dirty && (
                  <HelperText status="warning">Unsaved changes</HelperText>
                )}
                {saved && !dirty && (
                  <Text color="text-mid" size="small">
                    Saved.
                  </Text>
                )}
                {saveError && (
                  <HelperText status="error">{saveError}</HelperText>
                )}
              </Flex>
            </Box>
          );
          return saveBarHost ? createPortal(bar, saveBarHost) : bar;
        })()}
      </Flex>
    </>
  );
}
