import { useId, useState } from "react";
import { NotificationFilters } from "shared/validators";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { PiCaretDown, PiCaretUp } from "react-icons/pi";
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
import { useEnvironments } from "@/services/features";
import Button from "@/ui/Button";
import Checkbox from "@/ui/Checkbox";
import Switch from "@/ui/Switch";
import Heading from "@/ui/Heading";
import HelperText from "@/ui/HelperText";
import MultiSelectField from "@/ui/MultiSelectField";
import Text from "@/ui/Text";
import { Select, SelectItem } from "@/ui/Select";
import NotificationSettingsCard from "./NotificationSettingsCard";

export default function NotificationSubscriptionSettings({
  value,
  onChange,
}: {
  value: NotificationFilters;
  onChange: (value: NotificationFilters) => void;
}) {
  const categorySwitchId = useId();
  const { projects, tags } = useDefinitions();
  const environments = useEnvironments();
  const {
    events,
    projects: filterProjects,
    environments: filterEnvironments,
    tags: filterTags,
  } = value;
  const setEvents = (events: string[]) => onChange({ ...value, events });
  const setFilterProjects = (projects: string[]) =>
    onChange({ ...value, projects });
  const setFilterEnvironments = (environments: string[]) =>
    onChange({ ...value, environments });
  const setFilterTags = (tags: string[]) => onChange({ ...value, tags });
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

  return (
    <>
      <NotificationSettingsCard>
        <Heading as="h4" size="sm" mb="1">
          Scope
        </Heading>
        <Text as="p" color="text-mid" mb="3">
          Events must match any selected value in each filter. Empty filters
          include everything.
        </Text>
        <Grid
          columns={{ initial: "1", sm: "2" }}
          gapX="4"
          gapY="3"
          style={{ maxWidth: 620 }}
        >
          <MultiSelectField
            label="Projects"
            containerStyle={{ marginBottom: 0 }}
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
            containerStyle={{ marginBottom: 0 }}
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
          <Box>
            <Text as="label" size="md" weight="semibold">
              Tags
            </Text>
            <TagsInput
              size="lg"
              tagOptions={tags}
              value={filterTags}
              onChange={(value) => {
                setFilterTags(value);
              }}
              autoFocus={false}
              prompt="All Tags"
              creatable={false}
            />
          </Box>
        </Grid>
      </NotificationSettingsCard>

      {(Object.keys(notificationCategories) as NotificationEventCategory[]).map(
        (category) => {
          const options = notificationEventOptions.filter(
            (option) => option.category === category,
          );
          const categoryEvents = options.flatMap((option) => option.events);
          const selectedEventCount = categoryEvents.filter((event) =>
            events.some((subscription) =>
              matchesNotificationEvent(subscription, event),
            ),
          ).length;
          const selected = selectedEventCount > 0;
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
          const switchId = `${categorySwitchId}-${category}`;
          return (
            <NotificationSettingsCard key={category}>
              <Flex align="center" justify="between" gap="3" mb="1">
                <Heading as="h4" size="sm">
                  <label htmlFor={switchId} style={{ margin: 0 }}>
                    {title}
                  </label>
                </Heading>
                <Switch
                  id={switchId}
                  size="lg"
                  value={selected}
                  onChange={(value) => {
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
              </Flex>
              <Text as="p" color="text-mid" mb="0">
                {category === "experiment"
                  ? "Launches, results, decisions, and health warnings."
                  : category === "feature"
                    ? "Published versions, safe rollouts, drafts, and reviews."
                    : "Changes, drafts, and reviews."}
              </Text>
              {selected && (
                <Flex
                  align="center"
                  justify="between"
                  gap="3"
                  mt="2"
                  wrap="wrap"
                >
                  <Flex align="center" gap="3" wrap="wrap">
                    <Text size="md" weight="medium">
                      Notify about
                    </Text>
                    <Box style={{ width: 220 }}>
                      <Select
                        aria-label={`${title}: notify about`}
                        value={level}
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
                        <SelectItem value="default">
                          Recommended events
                        </SelectItem>
                        <SelectItem value="all">All events</SelectItem>
                        <SelectItem value="custom">Custom selection</SelectItem>
                      </Select>
                    </Box>
                    <Text size="sm" color="text-mid" whiteSpace="nowrap">
                      {selectedEventCount} of {categoryEvents.length}
                    </Text>
                  </Flex>
                  <Button
                    variant="ghost"
                    size="sm"
                    ml="auto"
                    aria-expanded={expanded}
                    icon={
                      expanded ? (
                        <PiCaretUp aria-hidden />
                      ) : (
                        <PiCaretDown aria-hidden />
                      )
                    }
                    iconPosition="right"
                    onClick={() =>
                      setExpandedCategories(
                        expanded
                          ? expandedCategories.filter(
                              (item) => item !== category,
                            )
                          : [...expandedCategories, category],
                      )
                    }
                  >
                    {expanded ? "Hide events" : "Show events"}
                  </Button>
                </Flex>
              )}
              {selected && hasNotificationWildcard(events, category) && (
                <Box mt="2">
                  <HelperText status="info">
                    {events.includes(`${category}.*`)
                      ? "All current and future events in this category are included. Choosing another level replaces this with a fixed list of events."
                      : "Some of these subscriptions use wildcards that also cover future events. Choosing a level replaces them with a fixed list of events."}
                  </HelperText>
                </Box>
              )}
              {expanded && selected && (
                <Flex direction="column" gap="4" mt="3">
                  {[...new Set(options.map((option) => option.group))].map(
                    (group) => (
                      <Box key={group}>
                        <Text
                          as="div"
                          size="md"
                          weight="medium"
                          color="text-mid"
                          mb="2"
                        >
                          {group}
                        </Text>
                        <Grid
                          columns={{ initial: "1", sm: "2" }}
                          gapX="5"
                          gapY="3"
                        >
                          {options
                            .filter((option) => option.group === group)
                            .map((option) => (
                              <Checkbox
                                key={option.id}
                                label={option.label}
                                description={
                                  option.subtitle ? (
                                    <Text size="sm">{option.subtitle}</Text>
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
                  {hasNotificationWildcard(events, category) && (
                    <HelperText status="info">
                      Customizing an event covered by “all events” keeps the
                      other currently available events selected.
                    </HelperText>
                  )}
                </Flex>
              )}
            </NotificationSettingsCard>
          );
        },
      )}
    </>
  );
}
