import { useMemo, useState } from "react";
import { NotificationFilters } from "shared/validators";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { PiImage } from "react-icons/pi";
import {
  notificationEventOptions,
  notificationCategories,
  getNotificationLevel,
  applyNotificationLevel,
  NotificationLevel,
  NotificationEventCategory,
  notificationEventSelection,
  toggleNotificationEvents,
  matchesNotificationEvent,
  hasNotificationWildcard,
} from "shared/notifications";
import TagsInput from "@/components/Tags/TagsInput";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useExperiments } from "@/hooks/useExperiments";
import { useFeaturesList, useEnvironments } from "@/services/features";
import Button from "@/ui/Button";
import Checkbox from "@/ui/Checkbox";
import Heading from "@/ui/Heading";
import Tooltip from "@/ui/Tooltip";
import HelperText from "@/ui/HelperText";
import MultiSelectField from "@/ui/MultiSelectField";
import Frame from "@/ui/Frame";
import Text from "@/ui/Text";
import { Select, SelectItem } from "@/ui/Select";

export default function NotificationSubscriptionSettings({
  value,
  onChange,
  cardEvents = [],
}: {
  value: NotificationFilters;
  onChange: (value: NotificationFilters) => void;
  cardEvents?: readonly string[];
}) {
  const { projects, tags, metrics, factMetrics } = useDefinitions();
  const { experiments } = useExperiments();
  const { features } = useFeaturesList();
  const environments = useEnvironments();
  const {
    events,
    projects: filterProjects,
    environments: filterEnvironments,
    tags: filterTags,
    experimentIds: filterExperiments = [],
    metricIds: filterMetrics = [],
    featureIds: filterFeatures = [],
  } = value;
  const setEvents = (events: string[]) => onChange({ ...value, events });
  const setFilterProjects = (projects: string[]) =>
    onChange({ ...value, projects });
  const setFilterEnvironments = (environments: string[]) =>
    onChange({ ...value, environments });
  const setFilterTags = (tags: string[]) => onChange({ ...value, tags });
  const setFilterExperiments = (experimentIds: string[]) =>
    onChange({ ...value, experimentIds });
  const setFilterMetrics = (metricIds: string[]) =>
    onChange({ ...value, metricIds });
  const setFilterFeatures = (featureIds: string[]) =>
    onChange({ ...value, featureIds });
  const [presetLevels, setPresetLevels] = useState<
    Partial<
      Record<NotificationEventCategory, Exclude<NotificationLevel, "custom">>
    >
  >({});
  const [manualLevels, setManualLevels] = useState<NotificationEventCategory[]>(
    [],
  );
  const [pausedEvents, setPausedEvents] = useState<
    Partial<Record<NotificationEventCategory, string[]>>
  >({});
  const [expandedCategories, setExpandedCategories] = useState<
    NotificationEventCategory[]
  >([]);
  const [showMoreFilters, setShowMoreFilters] = useState(
    filterTags.length +
      filterExperiments.length +
      filterMetrics.length +
      filterFeatures.length >
      0,
  );
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

  return (
    <>
      <Frame mb="0">
        <Heading as="h4" size="sm" mb="1">
          Scope
        </Heading>
        <Text as="p" color="text-mid" mb="3">
          Limit which events send notifications. Leave a filter empty to include
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
                onChange({
                  ...value,
                  tags: [],
                  experimentIds: [],
                  metricIds: [],
                  featureIds: [],
                });
                setShowMoreFilters(false);
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

      {(Object.keys(notificationCategories) as NotificationEventCategory[]).map(
        (category) => {
          const options = notificationEventOptions.filter(
            (option) => option.category === category,
          );
          const categoryEvents = options.flatMap((option) => option.events);
          const selected = categoryEvents.some((event) =>
            events.some((subscription) =>
              matchesNotificationEvent(subscription, event),
            ),
          );
          const level = manualLevels.includes(category)
            ? "custom"
            : (presetLevels[category] ??
              (selected
                ? getNotificationLevel(events, category)
                : pausedEvents[category]?.length
                  ? getNotificationLevel(pausedEvents[category], category)
                  : "default"));
          const resetCategory = () => {
            setPresetLevels({ ...presetLevels, [category]: "default" });
            setEvents(applyNotificationLevel(events, category, "default"));
            setManualLevels(manualLevels.filter((item) => item !== category));
          };
          const expanded = expandedCategories.includes(category);
          const title = notificationCategories[category];
          return (
            <Frame key={category} mb="0">
              <Heading as="h4" size="sm" mb="2">
                {title}
              </Heading>
              <Text as="p" color="text-mid" mb="4">
                Choose notifications about {title.toLowerCase()}.
              </Text>
              <Checkbox
                weight="medium"
                label="Event notifications"
                description={
                  category === "experiment"
                    ? "Launches, results, decisions, and health warnings."
                    : category === "feature"
                      ? "Published versions, safe rollouts, drafts, and reviews."
                      : "Changes, drafts, and reviews."
                }
                value={selected}
                setValue={(value) => {
                  if (value) {
                    const paused = pausedEvents[category];
                    if (paused?.length) {
                      setEvents([
                        ...events.filter(
                          (event) => !event.startsWith(`${category}.`),
                        ),
                        ...paused,
                      ]);
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
                        if (value !== "default" && value !== "all") return;
                        setPresetLevels({
                          ...presetLevels,
                          [category]: value,
                        });
                        setEvents(
                          applyNotificationLevel(events, category, value),
                        );
                        setManualLevels(
                          manualLevels.filter((item) => item !== category),
                        );
                      }}
                    >
                      <SelectItem value="default">Default</SelectItem>
                      <SelectItem value="all">All</SelectItem>
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
              {selected && hasNotificationWildcard(events, category) && (
                <Box
                  mt="2"
                  style={{ paddingLeft: "calc(16px + var(--space-2))" }}
                >
                  <HelperText status="info">
                    {events.includes(`${category}.*`)
                      ? "All current and future events in this category are included. Choosing another level replaces this with a fixed list of events."
                      : "Some of these subscriptions use wildcards that also cover future events. Choosing a level replaces them with a fixed list of events."}
                  </HelperText>
                </Box>
              )}
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
                                    cardEvents.includes(event),
                                  ) ? (
                                    <Tooltip content="Can include an image card when the selected style and event data support it.">
                                      <span
                                        tabIndex={0}
                                        style={{
                                          display: "inline-flex",
                                          alignItems: "center",
                                          gap: "var(--space-1)",
                                        }}
                                      >
                                        {option.label}
                                        <PiImage
                                          size={16}
                                          aria-label="Image card available"
                                          style={{
                                            color: "var(--violet-11)",
                                            flexShrink: 0,
                                          }}
                                        />
                                      </span>
                                    </Tooltip>
                                  ) : option.tooltip ? (
                                    <Tooltip content={option.tooltip}>
                                      <span
                                        tabIndex={0}
                                        style={{
                                          borderBottom:
                                            "1px dotted var(--gray-8)",
                                        }}
                                      >
                                        {option.label}
                                      </span>
                                    </Tooltip>
                                  ) : (
                                    option.label
                                  )
                                }
                                description={
                                  option.description ? (
                                    <span
                                      style={{ fontSize: "var(--font-size-1)" }}
                                    >
                                      {option.description}
                                    </span>
                                  ) : undefined
                                }
                                value={notificationEventSelection(
                                  events,
                                  option.events,
                                )}
                                setValue={(value) => {
                                  setEvents(
                                    toggleNotificationEvents(
                                      events,
                                      option.events,
                                      value,
                                    ),
                                  );
                                  setManualLevels([...manualLevels, category]);
                                }}
                              />
                            ))}
                        </Grid>
                      </Box>
                    ),
                  )}
                  {options.some((option) =>
                    option.events.some((event) => cardEvents.includes(event)),
                  ) && (
                    <Text as="div" size="md" color="text-mid">
                      <PiImage
                        size={16}
                        aria-hidden
                        style={{
                          color: "var(--violet-11)",
                          verticalAlign: "middle",
                        }}
                      />{" "}
                      Image-marked events can include a results-card image when
                      a card style is selected and the event supports it.
                    </Text>
                  )}
                  {hasNotificationWildcard(events, category) && (
                    <HelperText status="info">
                      Customizing an event covered by “all events” keeps the
                      other currently available events selected.
                    </HelperText>
                  )}
                </Flex>
              )}
            </Frame>
          );
        },
      )}
    </>
  );
}
