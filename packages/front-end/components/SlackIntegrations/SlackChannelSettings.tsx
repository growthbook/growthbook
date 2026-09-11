import { useMemo, useState } from "react";
import { ago } from "shared/dates";
import { createPortal } from "react-dom";
import { SlackOAuthIntegrationInterface } from "shared/types/slack-integration";
import {
  experimentCardFormats,
  SlackWorkspaceConnectionFrontEndInterface,
} from "shared/validators";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { PiTrash, PiPaperPlaneTilt, PiX } from "react-icons/pi";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import useApi from "@/hooks/useApi";
import TagsInput from "@/components/Tags/TagsInput";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import { useExperiments } from "@/hooks/useExperiments";
import { useFeaturesList, useEnvironments } from "@/services/features";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Heading from "@/ui/Heading";
import HelperText from "@/ui/HelperText";
import MultiSelectField from "@/ui/MultiSelectField";
import Frame from "@/ui/Frame";
import Text from "@/ui/Text";
import { Select, SelectItem, SelectGroup, SelectLabel } from "@/ui/Select";
import SlackEventPreview from "./SlackEventPreview";
import {
  slackEventOptions,
  slackNotificationLevel,
  applySlackNotificationLevel,
  SlackNotificationLevel,
  SlackEventCategory,
  slackEventSelection,
  toggleSlackEvents,
  matchesSlackEvent,
} from "./slackEventOptions";

const REQUIRED_SCOPES = [
  "chat:write",
  "files:write",
  "channels:read",
  "groups:read",
  "channels:join",
  "assistant:write",
  "im:history",
  "app_mentions:read",
  "commands",
  "links:read",
  "links:write",
];

const CARD_FORMAT_LABELS: Record<
  (typeof experimentCardFormats)[number],
  { label: string; description: string }
> = {
  none: {
    label: "No card — text only",
    description: "Send a text message only.",
  },
  compact: {
    label: "Compact card",
    description: "A short image highlighting the SRM warning.",
  },
  detailed: {
    label: "Detailed card",
    description: "A larger image with the SRM warning and a results table.",
  },
};

export const getSlackChannelLabel = (
  integration: SlackOAuthIntegrationInterface,
) => {
  const channelName = integration.slack?.channelName;
  if (channelName) {
    return channelName.startsWith("#") ? channelName : `#${channelName}`;
  }
  return integration.slack?.channelId || integration.name;
};

const getSlackWorkspaceLabel = (
  workspace: SlackWorkspaceConnectionFrontEndInterface,
) =>
  workspace.teamName ||
  workspace.teamId ||
  workspace.enterpriseName ||
  workspace.enterpriseId ||
  "Unknown workspace";

export default function SlackChannelSettings({
  integration,
  workspace,
  onSaved,
  onDeleted,
  saveBarHost,
  additionalDirty = false,
  onSaveAdditionalSettings,
  onDraftEnabledChange,
}: {
  integration: SlackOAuthIntegrationInterface;
  workspace: SlackWorkspaceConnectionFrontEndInterface;
  onSaved: () => Promise<void>;
  onDeleted: () => Promise<void>;
  saveBarHost?: HTMLDivElement | null;
  additionalDirty?: boolean;
  onSaveAdditionalSettings?: () => Promise<void>;
  onDraftEnabledChange?: (enabled: boolean) => void;
}) {
  const { apiCall } = useAuth();
  const { data: previewEvents, error: previewEventsError } = useApi<{
    events: string[];
  }>("/integrations/slack/preview-events");
  const [previewEvent, setPreviewEvent] = useState("experiment.warning");
  const [testEvent, setTestEvent] = useState("experiment.warning");
  const [showSendTest, setShowSendTest] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const eventChoices = slackEventOptions.flatMap((option) => {
    const event = option.events.find((event) =>
      previewEvents?.events.includes(event),
    );
    return event
      ? [
          {
            event,
            label:
              option.label +
              (event === "experiment.warning" ? " (SRM, card)" : " (text)"),
            group: `${option.category === "experiment" ? "Experiments" : "Feature Flags"} · ${option.group}`,
          },
        ]
      : [];
  });
  eventChoices.push(
    ...[
      {
        event: "digest:scorecard",
        label: "Experiment scorecard (image)",
        group: "Digests",
      },
      {
        event: "digest:feature",
        label: "Feature Flag digest (image)",
        group: "Digests",
      },
    ].filter((option) => previewEvents?.events.includes(option.event)),
  );
  const previewChoiceItems = [
    ...new Set(eventChoices.map((option) => option.group)),
  ].map((group) => (
    <SelectGroup key={group}>
      <SelectLabel>{group}</SelectLabel>
      {eventChoices
        .filter((option) => option.group === group)
        .map(({ event, label }) => (
          <SelectItem key={event} value={event}>
            {label}
          </SelectItem>
        ))}
    </SelectGroup>
  ));
  const { projects, tags, metrics, factMetrics } = useDefinitions();
  const { experiments } = useExperiments();
  const { features } = useFeaturesList();
  const environments = useEnvironments();
  const [enabled, setEnabled] = useState(integration.enabled);
  const [events, setEvents] = useState(integration.events);
  const [presetLevels, setPresetLevels] = useState<
    Partial<
      Record<SlackEventCategory, Exclude<SlackNotificationLevel, "custom">>
    >
  >({});
  const [manualLevels, setManualLevels] = useState<SlackEventCategory[]>([]);
  const [pausedEvents, setPausedEvents] = useState<
    Partial<Record<SlackEventCategory, string[]>>
  >({});
  const [expandedCategories, setExpandedCategories] = useState<
    SlackEventCategory[]
  >([]);
  const [cardFormat, setCardFormat] = useState(
    integration.slackOptions?.experimentCardFormat ?? "compact",
  );
  const [filterProjects, setFilterProjects] = useState(
    integration.projects || [],
  );
  const [filterEnvironments, setFilterEnvironments] = useState(
    integration.environments || [],
  );
  const [filterTags, setFilterTags] = useState(integration.tags || []);
  const [filterExperiments, setFilterExperiments] = useState(
    integration.experiments || [],
  );
  const [filterMetrics, setFilterMetrics] = useState(integration.metrics || []);
  const [filterFeatures, setFilterFeatures] = useState(
    integration.features || [],
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showMoreFilters, setShowMoreFilters] = useState(
    filterTags.length +
      filterExperiments.length +
      filterMetrics.length +
      filterFeatures.length >
      0,
  );
  const markDirty = () => {
    setSaved(false);
    setDirty(true);
  };
  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectError, setReconnectError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

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

  const grantedScopes = useMemo(
    () =>
      new Set(
        (workspace.scope || "")
          .split(",")
          .map((scope) => scope.trim())
          .filter(Boolean),
      ),
    [workspace.scope],
  );
  const needsReconnect = REQUIRED_SCOPES.some(
    (scope) => !grantedScopes.has(scope),
  );

  const save = async () => {
    if (events.length === 0) {
      setSaveError("Select at least one event.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await onSaveAdditionalSettings?.();
      await apiCall(`/integrations/slack/oauth/${integration.id}`, {
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
          slackOptions: { experimentCardFormat: cardFormat },
        }),
      });
      await onSaved();
      setSaved(true);
      setDirty(false);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Failed to save settings.",
      );
    } finally {
      setSaving(false);
    }
  };

  const reconnect = async () => {
    setReconnecting(true);
    setReconnectError(null);
    try {
      const response = await apiCall<{ url: string }>(
        "/integrations/slack/connect",
        {
          method: "POST",
          body: JSON.stringify({ teamId: workspace.teamId }),
        },
      );
      window.location.assign(response.url);
    } catch (error) {
      setReconnectError(
        error instanceof Error ? error.message : "Failed to start reconnect.",
      );
      setReconnecting(false);
    }
  };

  const deleteChannel = async () => {
    await apiCall(`/integrations/slack/${integration.id}`, {
      method: "DELETE",
    });
    await onDeleted();
  };

  const saveBar = (
    <Flex
      align="center"
      gap="3"
      py="3"
      style={{
        position: saveBarHost ? "static" : "sticky",
        paddingLeft: saveBarHost ? "var(--space-5)" : 0,
        bottom: 0,
        background: "var(--color-panel-solid)",
        borderTop: "1px solid var(--gray-a4)",
        zIndex: 1,
      }}
    >
      <Button
        onClick={save}
        loading={saving}
        disabled={!(dirty || additionalDirty) || events.length === 0}
      >
        Save settings
      </Button>
      {(dirty || additionalDirty) && (
        <HelperText status="warning">Unsaved changes</HelperText>
      )}
      {saved && !dirty && !additionalDirty && (
        <HelperText status="success">Saved.</HelperText>
      )}
      {saveError && <HelperText status="error">{saveError}</HelperText>}
    </Flex>
  );

  return (
    <>
      {showSendTest && (
        <ModalStandard
          open
          header="Send a Test Message"
          trackingEventModalType="slack-send-test-message"
          cta={`Send to ${getSlackChannelLabel(integration)}`}
          close={() => setShowSendTest(false)}
          submit={async () => {
            const result = await apiCall<{ delivery: "card" | "text" }>(
              `/integrations/slack/${integration.id}/test`,
              {
                method: "POST",
                body: JSON.stringify({
                  eventName: testEvent,
                  format: cardFormat,
                }),
              },
            );
            setTestResult(
              `Test ${result.delivery === "card" ? "card" : "message"} sent to ${getSlackChannelLabel(integration)}.`,
            );
          }}
        >
          <Text as="p" mb="3">
            Posts a sample notification to {getSlackChannelLabel(integration)}{" "}
            using the currently selected card style, without saving your
            settings or creating a real event.
          </Text>
          <Box mb="4">
            <Select
              label="Message type"
              value={testEvent}
              setValue={setTestEvent}
            >
              {previewChoiceItems}
            </Select>
          </Box>
          <SlackEventPreview eventName={testEvent} format={cardFormat} />
        </ModalStandard>
      )}
      {confirmingDelete && (
        <ConfirmDialog
          title="Delete Slack Channel Connection?"
          content={`${getSlackChannelLabel(
            integration,
          )} will stop receiving GrowthBook notifications.`}
          yesText="Delete"
          onConfirm={deleteChannel}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}

      <Flex direction="column" gap="4">
        <Flex justify="between" align="start" gap="4" wrap="wrap">
          <Box>
            <Heading as="h2" size="md" mb="1">
              {getSlackChannelLabel(integration)}
            </Heading>
            <Text color="text-mid">
              {getSlackWorkspaceLabel(workspace)}
              {integration.lastRunAt
                ? ` · last run ${ago(integration.lastRunAt)}`
                : " · no runs yet"}
            </Text>
          </Box>
          <Flex align="center" gap="3" wrap="wrap">
            <Checkbox
              label="Enabled"
              value={enabled}
              setValue={(value) => {
                setEnabled(value);
                onDraftEnabledChange?.(value);
                markDirty();
              }}
              weight="medium"
            />
            <Box
              style={{
                height: "var(--space-5)",
                borderLeft: "1px solid var(--gray-a6)",
              }}
            />
            <Button
              variant="outline"
              color="gray"
              size="sm"
              icon={<PiPaperPlaneTilt />}
              disabled={!previewEvents?.events.length}
              onClick={() => {
                setTestEvent(previewEvent);
                setShowSendTest(true);
              }}
            >
              Send test
            </Button>
            <Button
              variant="outline"
              color="red"
              size="sm"
              aria-label="Delete channel connection"
              title="Delete channel connection"
              onClick={() => setConfirmingDelete(true)}
            >
              <PiTrash />
            </Button>
          </Flex>
        </Flex>

        {previewEventsError && (
          <HelperText status="error">
            Could not load test events. Refresh to try again.
          </HelperText>
        )}
        {testResult && (
          <Callout status="success">
            <Flex align="center" justify="between" gap="3">
              <span>{testResult}</span>
              <Button
                aria-label="Dismiss"
                variant="ghost"
                color="gray"
                size="sm"
                onClick={() => setTestResult(null)}
              >
                <PiX />
              </Button>
            </Flex>
          </Callout>
        )}
        {needsReconnect && (
          <Flex direction="column" gap="2">
            <Callout
              status="warning"
              action={
                <Button onClick={reconnect} loading={reconnecting}>
                  Reconnect
                </Button>
              }
            >
              Reconnect this workspace to grant the Slack permissions needed for
              channel management, notifications, and posting experiment card
              images.
            </Callout>
            {reconnectError && (
              <HelperText status="error">{reconnectError}</HelperText>
            )}
          </Flex>
        )}

        <Frame mb="0">
          <Heading as="h3" size="md" mb="1">
            Scope
          </Heading>
          <Text as="p" color="text-mid" mb="3">
            Limit what this channel hears. Leave a filter empty to include
            everything; non-empty filters combine.
          </Text>
          <Grid
            columns={{ initial: "1", sm: "2" }}
            gap="4"
            style={{ maxWidth: 620 }}
          >
            <MultiSelectField
              label="Projects"
              placeholder="All Projects"
              value={filterProjects}
              size="lg"
              options={projects.map(({ id, name }) => ({
                label: name,
                value: id,
              }))}
              onChange={(value) => {
                setFilterProjects(value);
                markDirty();
              }}
            />
            <MultiSelectField
              label="Environments"
              placeholder="All Environments"
              value={filterEnvironments}
              size="lg"
              options={environments.map(({ id }) => ({
                label: id,
                value: id,
              }))}
              onChange={(value) => {
                setFilterEnvironments(value);
                markDirty();
              }}
            />
          </Grid>
          {showMoreFilters ? (
            <Box
              mt="4"
              style={{
                maxWidth: 620,
                paddingTop: "var(--space-4)",
                borderTop: "1px solid var(--gray-a4)",
              }}
            >
              <Grid columns={{ initial: "1", sm: "2" }} gap="4">
                <Box>
                  <Text as="label" size="md" weight="semibold">
                    Tags
                  </Text>
                  <TagsInput
                    tagOptions={tags}
                    value={filterTags}
                    onChange={(value) => {
                      setFilterTags(value);
                      markDirty();
                    }}
                    autoFocus={false}
                    prompt="All tags"
                    creatable={false}
                  />
                </Box>
                <Box>
                  <MultiSelectField
                    label="Experiments"
                    placeholder="All experiments"
                    value={filterExperiments}
                    options={experimentOptions}
                    onChange={(value) => {
                      setFilterExperiments(value);
                      markDirty();
                    }}
                  />
                </Box>
                <Box>
                  <MultiSelectField
                    label="Metrics"
                    placeholder="All metrics"
                    value={filterMetrics}
                    options={metricOptions}
                    onChange={(value) => {
                      setFilterMetrics(value);
                      markDirty();
                    }}
                  />
                  <Text as="p" size="sm" color="text-mid" mt="1">
                    Posts updates associated with any of these metrics.
                  </Text>
                </Box>
                <Box>
                  <MultiSelectField
                    label="Feature Flags"
                    placeholder="All feature flags"
                    value={filterFeatures}
                    options={featureOptions}
                    onChange={(value) => {
                      setFilterFeatures(value);
                      markDirty();
                    }}
                  />
                </Box>
              </Grid>
              <Button
                variant="ghost"
                color="gray"
                size="sm"
                mt="3"
                onClick={() => {
                  setFilterTags([]);
                  setFilterExperiments([]);
                  setFilterMetrics([]);
                  setFilterFeatures([]);
                  setShowMoreFilters(false);
                  markDirty();
                }}
              >
                − Remove all filters
              </Button>
            </Box>
          ) : (
            <Box>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowMoreFilters(true)}
              >
                + Add tag, experiment, metric or feature filter
              </Button>
            </Box>
          )}
        </Frame>

        {(["experiment", "feature"] as const).map((category) => {
          const options = slackEventOptions.filter(
            (option) => option.category === category,
          );
          const categoryEvents = options.flatMap((option) => option.events);
          const selected = categoryEvents.some((event) =>
            events.some((subscription) =>
              matchesSlackEvent(subscription, event),
            ),
          );
          const level = manualLevels.includes(category)
            ? "custom"
            : (presetLevels[category] ??
              (selected
                ? slackNotificationLevel(events, category)
                : pausedEvents[category]?.length
                  ? slackNotificationLevel(pausedEvents[category], category)
                  : "default"));
          const resetCategory = () => {
            setPresetLevels({ ...presetLevels, [category]: "default" });
            setEvents(applySlackNotificationLevel(events, category, "default"));
            setManualLevels(manualLevels.filter((item) => item !== category));
            markDirty();
          };
          const expanded = expandedCategories.includes(category);
          const title =
            category === "experiment" ? "Experiments" : "Feature Flags";
          return (
            <Frame key={category} mb="0">
              <Heading as="h3" size="md" mb="2">
                {title}
              </Heading>
              <Text as="p" color="text-mid" mb="4">
                What this channel hears about{" "}
                {category === "experiment" ? "experiments" : "Feature Flags"}.
              </Text>
              <Checkbox
                weight="medium"
                label="Event notifications"
                description={
                  category === "experiment"
                    ? "Launches, results, decisions, and health warnings."
                    : "Published versions, safe rollouts, drafts, and reviews."
                }
                value={selected}
                setValue={(value) => {
                  if (value) {
                    if (pausedEvents[category]?.length) {
                      setEvents([
                        ...events.filter(
                          (event) => !event.startsWith(`${category}.`),
                        ),
                        ...pausedEvents[category]!,
                      ]);
                      markDirty();
                    } else resetCategory();
                  } else {
                    setPausedEvents({
                      ...pausedEvents,
                      [category]: events.filter((event) =>
                        event.startsWith(`${category}.`),
                      ),
                    });
                    setEvents(
                      events.filter(
                        (event) => !event.startsWith(`${category}.`),
                      ),
                    );
                    markDirty();
                  }
                }}
              />
              <Flex
                align="center"
                justify="between"
                gap="3"
                mt="3"
                wrap="wrap"
                style={{
                  paddingLeft: "calc(16px + var(--space-2))",
                  maxWidth: 620,
                  opacity: selected ? 1 : 0.5,
                }}
              >
                <Flex align="center" gap="3">
                  <Text size="sm" weight="medium">
                    Level
                  </Text>
                  <Box style={{ width: 180 }}>
                    <Select
                      aria-label={`${title} notification level`}
                      value={level}
                      disabled={!selected}
                      setValue={(value) => {
                        if (value === "custom") {
                          setManualLevels([...manualLevels, category]);
                          setExpandedCategories([
                            ...expandedCategories,
                            category,
                          ]);
                          return;
                        }
                        setPresetLevels({
                          ...presetLevels,
                          [category]: value as Exclude<
                            SlackNotificationLevel,
                            "custom"
                          >,
                        });
                        setEvents(
                          applySlackNotificationLevel(
                            events,
                            category,
                            value as Exclude<SlackNotificationLevel, "custom">,
                          ),
                        );
                        setManualLevels(
                          manualLevels.filter((item) => item !== category),
                        );
                        markDirty();
                      }}
                    >
                      <SelectItem value="important">Only important</SelectItem>
                      <SelectItem value="default">Default</SelectItem>
                      <SelectItem value="full">Full</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </Select>
                  </Box>
                </Flex>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!selected}
                  onClick={() =>
                    setExpandedCategories(
                      expanded
                        ? expandedCategories.filter((item) => item !== category)
                        : [...expandedCategories, category],
                    )
                  }
                >
                  {expanded ? "Hide events" : "Customize events ›"}
                </Button>
              </Flex>
              {expanded && selected && (
                <Flex
                  direction="column"
                  gap="5"
                  mt="4"
                  style={{ paddingLeft: "calc(16px + var(--space-2))" }}
                >
                  {[...new Set(options.map((option) => option.group))].map(
                    (group) => (
                      <Box key={group}>
                        <Text
                          as="div"
                          size="md"
                          weight="medium"
                          color="text-mid"
                          mb="3"
                        >
                          {group}
                        </Text>
                        <Grid
                          columns={{ initial: "1", sm: "2" }}
                          gapX="5"
                          gapY="4"
                        >
                          {options
                            .filter((option) => option.group === group)
                            .map((option) => (
                              <Checkbox
                                key={option.id}
                                label={
                                  option.events.some((event) =>
                                    ["experiment.warning"].includes(event),
                                  ) ? (
                                    <>
                                      {option.label}
                                      <span
                                        title="Can include a results card when supported by the event data"
                                        style={{
                                          marginLeft: 5,
                                          color: "var(--violet-11)",
                                        }}
                                      >
                                        ▪
                                      </span>
                                    </>
                                  ) : (
                                    option.label
                                  )
                                }
                                description={option.description}
                                value={slackEventSelection(
                                  events,
                                  option.events,
                                )}
                                setValue={(value) => {
                                  setEvents(
                                    toggleSlackEvents(
                                      events,
                                      option.events,
                                      value,
                                    ),
                                  );
                                  setManualLevels([...manualLevels, category]);
                                  markDirty();
                                }}
                              />
                            ))}
                        </Grid>
                      </Box>
                    ),
                  )}
                  {category === "experiment" && (
                    <Text as="div" size="md" color="text-mid">
                      <span style={{ color: "var(--violet-11)" }}>▪</span> Can
                      include a results-card image when a card style is selected
                      and the event supports it. Warning cards are limited to
                      SRM warnings.
                    </Text>
                  )}
                  {events.some(
                    (event) =>
                      event.startsWith(`${category}.`) && event.endsWith(".*"),
                  ) && (
                    <HelperText status="info">
                      Customizing an event covered by “all events” keeps the
                      other currently available events selected.
                    </HelperText>
                  )}
                </Flex>
              )}
            </Frame>
          );
        })}

        {events.length === 0 && (
          <Callout status="warning">
            Select at least one event before saving. To pause all notifications,
            turn off Enabled at the top of this page.
          </Callout>
        )}

        <Frame mb="0">
          <Heading as="h3" size="md" mb="1">
            Results Card
          </Heading>
          <Text as="p" color="text-mid" mb="3">
            Choose how SRM warnings appear. Significance notifications and other
            events remain text-only.
          </Text>
          <Flex gap="6" align="start" wrap="wrap">
            <Box style={{ flex: 1, minWidth: 220 }}>
              <Box style={{ maxWidth: 420 }}>
                <Select
                  label="Card style"
                  value={cardFormat}
                  setValue={(value) => {
                    setCardFormat(
                      value as (typeof experimentCardFormats)[number],
                    );
                    markDirty();
                  }}
                >
                  {experimentCardFormats.map((format) => (
                    <SelectItem key={format} value={format}>
                      {CARD_FORMAT_LABELS[format].label}
                    </SelectItem>
                  ))}
                </Select>
              </Box>{" "}
            </Box>
            <Box style={{ width: 420, maxWidth: "100%" }}>
              <Text as="div" size="sm" weight="medium" color="text-mid" mb="2">
                PREVIEW
              </Text>
              <SlackEventPreview eventName={previewEvent} format={cardFormat} />
              <Box mt="3">
                <Select
                  label="Preview event"
                  value={previewEvent}
                  setValue={setPreviewEvent}
                >
                  {previewChoiceItems}
                </Select>
              </Box>
              <Text as="p" color="text-mid" size="sm" mt="2">
                Sample data. Events without image support appear as text.
              </Text>
            </Box>
          </Flex>
        </Frame>

        {saveBarHost ? createPortal(saveBar, saveBarHost) : saveBar}
      </Flex>
    </>
  );
}
