import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { NextPage } from "next";
import { useRouter } from "next/router";
import { SlackOAuthIntegrationInterface } from "shared/types/slack-integration";
import { ago } from "shared/dates";
import { Box, Flex } from "@radix-ui/themes";
import { FaSlack } from "react-icons/fa";
import { PiGearSix, PiTrash } from "react-icons/pi";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import LinkButton from "@/ui/LinkButton";
import Badge from "@/ui/Badge";
import Checkbox from "@/ui/Checkbox";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { Select, SelectItem } from "@/ui/Select";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import { displayedEvents } from "@/components/EventWebHooks/utils";

type SlackIntegrationsResponse = {
  slackIntegrations: SlackOAuthIntegrationInterface[];
  oauthConfigured: boolean;
};

const MAX_EVENTS_DISPLAY = 3;

const NOTIFICATION_RECIPES = [
  {
    id: "milestones",
    label: "Experiment milestones",
    description:
      "Notify when experiments launch, approach their end date, or finish.",
    examples: "Launched, ending soon, shipped, rolled back",
    recommended: true,
    events: [
      "experiment.started",
      "experiment.endingSoon",
      "experiment.stopped.shipped",
      "experiment.stopped.rolledback",
    ],
  },
  {
    id: "data-quality",
    label: "Data problems",
    description:
      "Notify when results cannot be trusted or the refresh pipeline needs attention.",
    examples: "Query failed, no data, SRM, guardrail failed, metric regression",
    recommended: true,
    events: [
      "experiment.warning",
      "experiment.health.guardrailFailed",
      "experiment.health.noData",
      "experiment.health.queryFailed",
      "experiment.metric.regression",
    ],
  },
  {
    id: "decisions",
    label: "Results and decisions",
    description:
      "Notify when results reach significance or the decision framework recommends action.",
    examples: "Significant metric, ready for review, ship, roll back",
    recommended: true,
    events: [
      "experiment.info.significance",
      "experiment.decision.ship",
      "experiment.decision.rollback",
      "experiment.decision.review",
    ],
  },
  {
    id: "stale-experiments",
    label: "Long-running experiments",
    description:
      "Notify when running experiments may be stuck and need an owner decision.",
    examples: "Experiment running for 90+ days",
    recommended: false,
    events: ["experiment.stale"],
  },
  {
    id: "feature-rollouts",
    label: "Feature rollout safety",
    description:
      "Notify release channels when safe rollouts or ramp schedules need attention.",
    examples: "Safe rollout ready, rollback recommended, ramp approval needed",
    recommended: false,
    events: [
      "feature.saferollout.ship",
      "feature.saferollout.rollback",
      "feature.saferollout.unhealthy",
      "feature.rampSchedule.actions.step.approvalRequired",
      "feature.rampSchedule.actions.completed",
      "feature.rampSchedule.actions.rolledBack",
    ],
  },
  {
    id: "reviews",
    label: "Review activity",
    description:
      "Notify when feature revisions need review or receive review feedback.",
    examples: "Review requested, approved, changes requested, published",
    recommended: false,
    events: [
      "feature.revision.reviewRequested",
      "feature.revision.approved",
      "feature.revision.changesRequested",
      "feature.revision.commented",
      "feature.revision.published",
    ],
  },
  {
    id: "advanced-experiments",
    label: "Advanced experiment types",
    description:
      "Notify for bandit weight changes and holdout configuration updates.",
    examples: "Bandit weights changed, holdout created or updated",
    recommended: false,
    events: [
      "experiment.bandit.weightsChanged",
      "experiment.holdout.created",
      "experiment.holdout.updated",
    ],
  },
  {
    id: "audit",
    label: "Configuration audit trail",
    description:
      "Notify when experiments or feature flags are created, edited, deleted, or change status.",
    examples: "Experiment updated, feature changed, status changed",
    recommended: false,
    events: [
      "experiment.created",
      "experiment.updated",
      "experiment.deleted",
      "experiment.status.changed",
      "feature.created",
      "feature.updated",
      "feature.deleted",
    ],
  },
] as const;

const NOTIFICATION_RECIPE_EVENTS = NOTIFICATION_RECIPES.flatMap(
  (recipe) => recipe.events,
);

type NotificationRecipe = (typeof NOTIFICATION_RECIPES)[number];

const EVENT_CONTROL_COPY: Record<
  string,
  { label: string; description: string }
> = {
  "experiment.started": {
    label: "Experiment launched",
    description: "The experiment starts running.",
  },
  "experiment.endingSoon": {
    label: "Experiment ending soon",
    description: "A running experiment is close to its scheduled end date.",
  },
  "experiment.stopped.shipped": {
    label: "Experiment shipped",
    description: "The experiment stops and a winning variation is shipped.",
  },
  "experiment.stopped.rolledback": {
    label: "Experiment rolled back",
    description: "The experiment stops and rolls back to control.",
  },
  "experiment.warning": {
    label: "Experiment warning detected",
    description: "GrowthBook detects a warning condition like SRM.",
  },
  "experiment.health.guardrailFailed": {
    label: "Guardrail failed",
    description: "A running experiment has a failing guardrail metric.",
  },
  "experiment.health.noData": {
    label: "No data after refresh",
    description: "Results refreshed successfully but returned no data.",
  },
  "experiment.health.queryFailed": {
    label: "Experiment updates failed",
    description: "Results could not refresh because the query failed.",
  },
  "experiment.metric.regression": {
    label: "Metric regression detected",
    description: "A metric moved in the wrong direction.",
  },
  "experiment.info.significance": {
    label: "Metric reached significance",
    description: "A goal, secondary, or guardrail metric reaches significance.",
  },
  "experiment.decision.ship": {
    label: "Ready to ship",
    description: "The decision framework recommends shipping a variation.",
  },
  "experiment.decision.rollback": {
    label: "Ready to roll back",
    description: "The decision framework recommends rolling back to control.",
  },
  "experiment.decision.review": {
    label: "Needs human review",
    description: "Results reached the decision point but are ambiguous.",
  },
  "experiment.stale": {
    label: "Experiment running too long",
    description: "A running experiment may be stuck without a decision.",
  },
  "feature.saferollout.ship": {
    label: "Safe rollout ready to ship",
    description: "A safe rollout can move to 100%.",
  },
  "feature.saferollout.rollback": {
    label: "Safe rollout should roll back",
    description:
      "A failing guardrail indicates the rollout should be reverted.",
  },
  "feature.saferollout.unhealthy": {
    label: "Safe rollout unhealthy",
    description: "A safe rollout is failing a health check.",
  },
  "feature.rampSchedule.actions.step.approvalRequired": {
    label: "Ramp step needs approval",
    description: "A scheduled ramp is waiting for manual approval.",
  },
  "feature.rampSchedule.actions.completed": {
    label: "Ramp schedule completed",
    description: "A ramp schedule completed all steps.",
  },
  "feature.rampSchedule.actions.rolledBack": {
    label: "Ramp schedule rolled back",
    description: "A ramp schedule was rolled back or reset.",
  },
  "feature.revision.reviewRequested": {
    label: "Review requested",
    description: "A draft feature revision was submitted for review.",
  },
  "feature.revision.approved": {
    label: "Review approved",
    description: "A reviewer approved a draft feature revision.",
  },
  "feature.revision.changesRequested": {
    label: "Changes requested",
    description: "A reviewer requested changes on a draft revision.",
  },
  "feature.revision.commented": {
    label: "Review comment added",
    description: "Someone commented on a draft feature revision.",
  },
  "feature.revision.published": {
    label: "Revision published",
    description: "A reviewed feature revision was published.",
  },
  "experiment.bandit.weightsChanged": {
    label: "Bandit weights changed",
    description: "A multi-armed bandit materially changed variation weights.",
  },
  "experiment.holdout.created": {
    label: "Holdout created",
    description: "A new holdout was created.",
  },
  "experiment.holdout.updated": {
    label: "Holdout updated",
    description: "An existing holdout was updated.",
  },
  "experiment.created": {
    label: "Experiment created",
    description: "A new experiment was created.",
  },
  "experiment.updated": {
    label: "Experiment updated",
    description: "Experiment settings or configuration changed.",
  },
  "experiment.deleted": {
    label: "Experiment deleted",
    description: "An experiment was deleted.",
  },
  "experiment.status.changed": {
    label: "Experiment status changed",
    description: "An experiment moved between lifecycle statuses.",
  },
  "feature.created": {
    label: "Feature flag created",
    description: "A new feature flag was created.",
  },
  "feature.updated": {
    label: "Feature flag updated",
    description: "A feature flag configuration changed.",
  },
  "feature.deleted": {
    label: "Feature flag deleted",
    description: "A feature flag was deleted.",
  },
};

const COALESCE_OPTIONS = [
  { value: "0", label: "Send every notification immediately" },
  { value: "15000", label: "Bundle related bursts for 15 seconds" },
  { value: "60000", label: "Bundle related bursts for 1 minute" },
  { value: "300000", label: "Bundle related bursts for 5 minutes" },
];

const DAILY_DIGEST_OPTIONS = [
  { value: "none", label: "Do not send a daily digest" },
  { value: "0", label: "Daily digest at 00:00 UTC" },
  { value: "9", label: "Daily digest at 09:00 UTC" },
  { value: "12", label: "Daily digest at 12:00 UTC" },
  { value: "16", label: "Daily digest at 16:00 UTC" },
  { value: "21", label: "Daily digest at 21:00 UTC" },
];

const wildcardMatchesEvent = (wildcard: string, event: string) => {
  if (!wildcard.endsWith(".*")) return false;
  return event.startsWith(wildcard.slice(0, -1));
};

const eventIsEnabled = (events: string[], eventName: string) =>
  events.includes(eventName) ||
  events.some((event) => wildcardMatchesEvent(event, eventName));

const wildcardOverlapsVisibleRecipe = (event: string) =>
  event.endsWith(".*") &&
  NOTIFICATION_RECIPE_EVENTS.some((recipeEvent) =>
    wildcardMatchesEvent(event, recipeEvent),
  );

const expandVisibleRecipeEvents = (events: string[]) => {
  const nextEvents = new Set(
    events.filter((event) => !wildcardOverlapsVisibleRecipe(event)),
  );

  events.forEach((event) => {
    if (!wildcardOverlapsVisibleRecipe(event)) return;
    NOTIFICATION_RECIPE_EVENTS.forEach((recipeEvent) => {
      if (wildcardMatchesEvent(event, recipeEvent)) {
        nextEvents.add(recipeEvent);
      }
    });
  });

  return nextEvents;
};

const getRecipeValue = (
  events: string[],
  recipe: NotificationRecipe,
): boolean | "indeterminate" => {
  const enabledCount = recipe.events.filter((event) =>
    eventIsEnabled(events, event),
  ).length;
  if (enabledCount === recipe.events.length) return true;
  if (enabledCount > 0) return "indeterminate";
  return false;
};

const updateEventsForRecipe = ({
  events,
  recipe,
  enabled,
}: {
  events: string[];
  recipe: NotificationRecipe;
  enabled: boolean;
}) => {
  const nextEvents = expandVisibleRecipeEvents(events);

  recipe.events.forEach((event) => {
    if (enabled) {
      nextEvents.add(event);
    } else {
      nextEvents.delete(event);
    }
  });

  return [...nextEvents];
};

const updateEventsForRecipeSelection = ({
  events,
  recipe,
  selectedEvents,
}: {
  events: string[];
  recipe: NotificationRecipe;
  selectedEvents: string[];
}) => {
  const nextEvents = expandVisibleRecipeEvents(events);

  recipe.events.forEach((event) => {
    nextEvents.delete(event);
  });
  selectedEvents.forEach((event) => {
    nextEvents.add(event);
  });

  return [...nextEvents];
};

const getRecommendedEvents = (events: string[]) => {
  const nextEvents = expandVisibleRecipeEvents(events);
  NOTIFICATION_RECIPES.forEach((recipe) => {
    if (!recipe.recommended) return;
    recipe.events.forEach((event) => nextEvents.add(event));
  });
  return [...nextEvents];
};

const getEnabledRecipeLabels = (events: string[]) =>
  NOTIFICATION_RECIPES.filter(
    (recipe) => getRecipeValue(events, recipe) === true,
  ).map((recipe) => recipe.label);

const getQueryStringValue = (value: string | string[] | undefined) => {
  if (Array.isArray(value)) return value[0];
  return value;
};

const getSlackChannelLabel = (
  slackIntegration: SlackOAuthIntegrationInterface,
) =>
  slackIntegration.slack?.channelName ||
  slackIntegration.slack?.channelId ||
  slackIntegration.name;

const getSlackWorkspaceLabel = (
  slackIntegration: SlackOAuthIntegrationInterface,
) =>
  slackIntegration.slack?.teamName ||
  slackIntegration.slack?.teamId ||
  slackIntegration.slack?.enterpriseName ||
  slackIntegration.slack?.enterpriseId ||
  "Unknown workspace";

type RecipeDeliverySettings = {
  coalesceWindowMs: number;
  dailyDigestHourUtc: number | null;
};

const getInitialCoalesceWindow = (
  slackIntegration: SlackOAuthIntegrationInterface,
) => {
  const coalesceWindowMs = slackIntegration.coalesceWindowMs ?? 0;
  if (
    COALESCE_OPTIONS.some((option) => option.value === `${coalesceWindowMs}`)
  ) {
    return `${coalesceWindowMs}`;
  }
  return "15000";
};

const getInitialDailyDigestHour = (
  slackIntegration: SlackOAuthIntegrationInterface,
) =>
  slackIntegration.dailyDigestHourUtc === undefined
    ? "none"
    : `${slackIntegration.dailyDigestHourUtc}`;

const getEventControlCopy = (eventName: string) =>
  EVENT_CONTROL_COPY[eventName] || {
    label: eventName,
    description: "Receive this GrowthBook notification.",
  };

const SlackNotificationRecipesPanel = ({
  slackIntegration,
  saving,
  error,
  onRecipeChange,
  onApplyRecommended,
  onCustomize,
}: {
  slackIntegration: SlackOAuthIntegrationInterface;
  saving: boolean;
  error: string | null;
  onRecipeChange: (
    slackIntegration: SlackOAuthIntegrationInterface,
    recipe: NotificationRecipe,
    enabled: boolean,
  ) => Promise<void>;
  onApplyRecommended: (
    slackIntegration: SlackOAuthIntegrationInterface,
  ) => Promise<void>;
  onCustomize: (
    slackIntegration: SlackOAuthIntegrationInterface,
    recipe: NotificationRecipe,
  ) => void;
}) => (
  <Box
    p="4"
    style={{
      border: "1px solid var(--gray-a5)",
      borderRadius: "var(--radius-4)",
      background: "linear-gradient(180deg, var(--gray-a2), var(--gray-a1) 70%)",
    }}
  >
    <Flex direction="column" gap="4">
      <Flex justify="between" gap="4" align="start" wrap="wrap">
        <Box style={{ maxWidth: 720 }}>
          <Flex align="center" gap="2" mb="1">
            <Text weight="medium">Notification recipes</Text>
          </Flex>
          <Text as="p" color="text-mid" mb="0">
            Choose outcomes your team cares about. GrowthBook maps these to the
            underlying webhook events, so you do not need to memorize event
            names.
          </Text>
        </Box>
        <Button
          variant="outline"
          color="gray"
          disabled={saving}
          onClick={() => onApplyRecommended(slackIntegration)}
        >
          Apply recommended
        </Button>
      </Flex>

      {error && (
        <Callout status="error" mb="0">
          {error}
        </Callout>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 12,
        }}
      >
        {NOTIFICATION_RECIPES.map((recipe) => {
          const enabled = getRecipeValue(slackIntegration.events, recipe);
          return (
            <Box
              key={recipe.id}
              p="3"
              style={{
                border: `1px solid ${
                  enabled === true ? "var(--accent-a7)" : "var(--gray-a5)"
                }`,
                borderRadius: "var(--radius-4)",
                background:
                  enabled === true ? "var(--accent-a2)" : "var(--color-panel)",
                minHeight: 150,
              }}
            >
              <Flex direction="column" gap="2" height="100%">
                <Flex align="start" justify="between" gap="3">
                  <Checkbox
                    label={recipe.label}
                    description={recipe.description}
                    value={enabled}
                    setValue={(checked) =>
                      onRecipeChange(slackIntegration, recipe, checked)
                    }
                    disabled={saving}
                  />
                </Flex>
                <Box mt="auto" pl="4">
                  <Flex direction="column" gap="2" align="start">
                    <Text size="small" color="text-mid">
                      {recipe.examples}
                    </Text>
                    <Button
                      variant="ghost"
                      color="gray"
                      size="xs"
                      disabled={saving}
                      onClick={() => onCustomize(slackIntegration, recipe)}
                    >
                      Customize
                    </Button>
                  </Flex>
                </Box>
              </Flex>
            </Box>
          );
        })}
      </div>

      <Flex gap="3" wrap="wrap">
        <Callout status="info" mb="0">
          Advanced filters live in Configure: project, environment, tag,
          experiment, metric, burst digest, and daily digest.
        </Callout>
        <Callout status="info" mb="0">
          Slack users can also run <code>/growthbook list</code> and{" "}
          <code>/growthbook status &lt;experiment-id&gt;</code>.
        </Callout>
      </Flex>
    </Flex>
  </Box>
);

const SlackRecipeCustomizeModal = ({
  slackIntegration,
  recipe,
  close,
  submit,
}: {
  slackIntegration: SlackOAuthIntegrationInterface;
  recipe: NotificationRecipe;
  close: () => void;
  submit: (
    slackIntegration: SlackOAuthIntegrationInterface,
    recipe: NotificationRecipe,
    selectedEvents: string[],
    deliverySettings: RecipeDeliverySettings,
  ) => Promise<void>;
}) => {
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [coalesceWindowMs, setCoalesceWindowMs] = useState("0");
  const [dailyDigestHourUtc, setDailyDigestHourUtc] = useState("none");

  useEffect(() => {
    setSelectedEvents(
      recipe.events.filter((event) =>
        eventIsEnabled(slackIntegration.events, event),
      ),
    );
    setCoalesceWindowMs(getInitialCoalesceWindow(slackIntegration));
    setDailyDigestHourUtc(getInitialDailyDigestHour(slackIntegration));
  }, [recipe, slackIntegration]);

  const totalEventsAfterSave = updateEventsForRecipeSelection({
    events: slackIntegration.events,
    recipe,
    selectedEvents,
  }).length;

  return (
    <ModalStandard
      open={true}
      close={close}
      header={`Customize ${recipe.label}`}
      subheader={
        <>
          Choose exactly which Slack notifications this recipe sends for{" "}
          <strong>{getSlackChannelLabel(slackIntegration)}</strong>.
        </>
      }
      cta="Save changes"
      ctaEnabled={totalEventsAfterSave > 0}
      size="lg"
      trackingEventModalType=""
      submit={async () => {
        if (!totalEventsAfterSave) {
          throw new Error(
            "Choose at least one notification, or use Configure to disable this Slack channel.",
          );
        }

        await submit(slackIntegration, recipe, selectedEvents, {
          coalesceWindowMs: Number(coalesceWindowMs),
          dailyDigestHourUtc:
            dailyDigestHourUtc === "none" ? null : Number(dailyDigestHourUtc),
        });
      }}
    >
      <Flex direction="column" gap="5">
        <Box>
          <Heading as="h3" size="small" mb="3">
            Notifications
          </Heading>
          <Flex direction="column" gap="3">
            {recipe.events.map((eventName) => {
              const copy = getEventControlCopy(eventName);
              return (
                <Box
                  key={eventName}
                  p="3"
                  style={{
                    border: "1px solid var(--gray-a5)",
                    borderRadius: "var(--radius-3)",
                    background: "var(--color-panel)",
                  }}
                >
                  <Checkbox
                    label={copy.label}
                    description={copy.description}
                    value={selectedEvents.includes(eventName)}
                    setValue={(checked) => {
                      setSelectedEvents((current) =>
                        checked
                          ? [...new Set([...current, eventName])]
                          : current.filter((event) => event !== eventName),
                      );
                    }}
                    weight="medium"
                  />
                </Box>
              );
            })}
          </Flex>
        </Box>

        <Box>
          <Heading as="h3" size="small" mb="3">
            Delivery
          </Heading>
          <Flex direction="column" gap="4">
            <Select
              label="Burst handling"
              value={coalesceWindowMs}
              setValue={setCoalesceWindowMs}
            >
              {COALESCE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </Select>

            <Select
              label="Daily digest"
              value={dailyDigestHourUtc}
              setValue={setDailyDigestHourUtc}
            >
              {DAILY_DIGEST_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </Select>
          </Flex>
        </Box>

        <Callout status="info" mb="0">
          Use Configure for project, environment, tag, experiment, and metric
          filters.
        </Callout>
      </Flex>
    </ModalStandard>
  );
};

const SlackIntegrationsPage: NextPage = () => {
  const permissionsUtils = usePermissionsUtil();
  const router = useRouter();
  const { apiCall } = useAuth();
  const callbackProcessed = useRef(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [savingPresetFor, setSavingPresetFor] = useState<string | null>(null);
  const [recipeErrorFor, setRecipeErrorFor] = useState<{
    id: string;
    message: string;
  } | null>(null);
  const [customizeRecipe, setCustomizeRecipe] = useState<{
    slackIntegration: SlackOAuthIntegrationInterface;
    recipe: NotificationRecipe;
  } | null>(null);

  const {
    data,
    mutate,
    error: loadError,
  } = useApi<SlackIntegrationsResponse>("/integrations/slack");

  const slackIntegrations = useMemo(
    () => data?.slackIntegrations || [],
    [data?.slackIntegrations],
  );
  const loadingIntegrations = !data && !loadError;

  useEffect(() => {
    if (!router.isReady || callbackProcessed.current) return;

    const slackError = getQueryStringValue(router.query.error);
    if (slackError) {
      callbackProcessed.current = true;
      setConnectError(`Slack authorization failed: ${slackError}`);
      router.replace("/integrations/slack", undefined, { shallow: true });
      return;
    }

    const code = getQueryStringValue(router.query.code);
    const state = getQueryStringValue(router.query.state);
    if (!code || !state) return;

    callbackProcessed.current = true;
    setConnecting(true);
    setConnectError(null);

    apiCall<{ slackIntegration: SlackOAuthIntegrationInterface }>(
      "/integrations/slack/oauth-callback",
      {
        method: "POST",
        body: JSON.stringify({ code, state }),
      },
    )
      .then(async () => {
        await mutate();
        await router.replace("/integrations/slack", undefined, {
          shallow: true,
        });
      })
      .catch((e) => {
        setConnectError(e.message);
      })
      .finally(() => {
        setConnecting(false);
      });
  }, [apiCall, mutate, router]);

  const connectToSlack = useCallback(async () => {
    setConnectError(null);

    const response = await apiCall<{ url: string }>(
      "/integrations/slack/connect",
      {
        method: "POST",
      },
    );
    window.location.href = response.url;
  }, [apiCall]);

  const deleteIntegration = useCallback(
    async (slackIntegration: SlackOAuthIntegrationInterface) => {
      if (
        !window.confirm(
          `Delete the Slack integration for ${getSlackChannelLabel(
            slackIntegration,
          )}?`,
        )
      ) {
        return;
      }

      await apiCall(`/integrations/slack/${slackIntegration.id}`, {
        method: "DELETE",
      });
      await mutate();
    },
    [apiCall, mutate],
  );

  const updateRecipe = useCallback(
    async (
      slackIntegration: SlackOAuthIntegrationInterface,
      recipe: NotificationRecipe,
      enabled: boolean,
    ) => {
      setSavingPresetFor(slackIntegration.id);
      setRecipeErrorFor(null);
      try {
        const events = updateEventsForRecipe({
          events: slackIntegration.events,
          recipe,
          enabled,
        });

        if (!events.length) {
          setRecipeErrorFor({
            id: slackIntegration.id,
            message:
              "Choose at least one notification recipe, or use Configure to disable this Slack channel.",
          });
          return;
        }

        await apiCall(`/event-webhooks/${slackIntegration.eventWebHookId}`, {
          method: "PUT",
          body: JSON.stringify({
            events,
          }),
        });
        await mutate();
      } catch (e) {
        setRecipeErrorFor({
          id: slackIntegration.id,
          message: e instanceof Error ? e.message : "Failed to update recipes.",
        });
      } finally {
        setSavingPresetFor(null);
      }
    },
    [apiCall, mutate],
  );

  const applyRecommended = useCallback(
    async (slackIntegration: SlackOAuthIntegrationInterface) => {
      setSavingPresetFor(slackIntegration.id);
      setRecipeErrorFor(null);
      try {
        await apiCall(`/event-webhooks/${slackIntegration.eventWebHookId}`, {
          method: "PUT",
          body: JSON.stringify({
            events: getRecommendedEvents(slackIntegration.events),
          }),
        });
        await mutate();
      } catch (e) {
        setRecipeErrorFor({
          id: slackIntegration.id,
          message: e instanceof Error ? e.message : "Failed to update recipes.",
        });
      } finally {
        setSavingPresetFor(null);
      }
    },
    [apiCall, mutate],
  );

  const updateRecipeCustomization = useCallback(
    async (
      slackIntegration: SlackOAuthIntegrationInterface,
      recipe: NotificationRecipe,
      selectedEvents: string[],
      deliverySettings: RecipeDeliverySettings,
    ) => {
      setSavingPresetFor(slackIntegration.id);
      setRecipeErrorFor(null);

      try {
        const events = updateEventsForRecipeSelection({
          events: slackIntegration.events,
          recipe,
          selectedEvents,
        });

        if (!events.length) {
          throw new Error(
            "Choose at least one notification, or use Configure to disable this Slack channel.",
          );
        }

        await apiCall(`/event-webhooks/${slackIntegration.eventWebHookId}`, {
          method: "PUT",
          body: JSON.stringify({
            events,
            coalesceWindowMs: deliverySettings.coalesceWindowMs,
            dailyDigestHourUtc: deliverySettings.dailyDigestHourUtc,
          }),
        });
        await mutate();
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Failed to update recipes.";
        setRecipeErrorFor({
          id: slackIntegration.id,
          message,
        });
        throw new Error(message);
      } finally {
        setSavingPresetFor(null);
      }
    },
    [apiCall, mutate],
  );

  if (!permissionsUtils.canManageIntegrations()) {
    return (
      <div className="container-fluid pagecontents">
        <Callout status="error">
          You do not have access to view this page.
        </Callout>
      </div>
    );
  }

  return (
    <div className="container-fluid pagecontents">
      {customizeRecipe && (
        <SlackRecipeCustomizeModal
          slackIntegration={customizeRecipe.slackIntegration}
          recipe={customizeRecipe.recipe}
          close={() => setCustomizeRecipe(null)}
          submit={updateRecipeCustomization}
        />
      )}
      <Flex direction="column" gap="5">
        <Flex justify="between" align="start" gap="4" wrap="wrap">
          <Box>
            <Flex align="center" gap="2" mb="2">
              <Badge label="Beta" color="violet" variant="soft" />
              <Heading as="h1" size="large">
                Slack Integrations
              </Heading>
            </Flex>
            <Text as="p" color="text-mid" mb="0">
              Connect Slack channels to GrowthBook notifications.
            </Text>
          </Box>

          <Button
            icon={<FaSlack />}
            onClick={connectToSlack}
            loading={connecting}
            disabled={!data?.oauthConfigured}
          >
            Connect to Slack
          </Button>
        </Flex>

        {data && !data.oauthConfigured && (
          <Callout status="warning">
            Slack OAuth is not configured. Set SLACK_CLIENT_ID and
            SLACK_CLIENT_SECRET on the GrowthBook API server.
          </Callout>
        )}

        {connectError && <Callout status="error">{connectError}</Callout>}

        {loadError && (
          <Callout status="error">
            Failed to load Slack integrations: {loadError.message}
          </Callout>
        )}

        {connecting && (
          <Callout status="info">
            Connecting Slack and creating the Event Webhook.
          </Callout>
        )}

        {loadingIntegrations && (
          <Callout status="info">Loading Slack integrations.</Callout>
        )}

        {!loadingIntegrations && !loadError && (
          <>
            {slackIntegrations.length === 0 ? (
              <Box p="4" style={{ border: "1px solid var(--gray-a5)" }}>
                <Flex direction="column" gap="3" align="start">
                  <Heading as="h2" size="small">
                    No Slack channels connected
                  </Heading>
                  <Text color="text-mid">
                    Connect a channel to create a Slack Event Webhook. You can
                    add more channels by running the Slack connection flow
                    again.
                  </Text>
                  <Button
                    icon={<FaSlack />}
                    onClick={connectToSlack}
                    loading={connecting}
                    disabled={!data?.oauthConfigured}
                  >
                    Connect to Slack
                  </Button>
                </Flex>
              </Box>
            ) : (
              <Table variant="list">
                <TableHeader>
                  <TableRow>
                    <TableColumnHeader>Channel</TableColumnHeader>
                    <TableColumnHeader>Workspace</TableColumnHeader>
                    <TableColumnHeader>Recipes</TableColumnHeader>
                    <TableColumnHeader>Status</TableColumnHeader>
                    <TableColumnHeader>Last run</TableColumnHeader>
                    <TableColumnHeader style={{ width: 190 }} />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {slackIntegrations.map((slackIntegration) => (
                    <React.Fragment key={slackIntegration.id}>
                      <TableRow>
                        <TableCell>
                          <Text weight="medium">
                            {getSlackChannelLabel(slackIntegration)}
                          </Text>
                        </TableCell>
                        <TableCell>
                          {getSlackWorkspaceLabel(slackIntegration)}
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const enabledRecipes = getEnabledRecipeLabels(
                              slackIntegration.events,
                            );
                            if (!enabledRecipes.length) {
                              return displayedEvents(slackIntegration.events, {
                                maxEventsDisplay: MAX_EVENTS_DISPLAY,
                              });
                            }

                            return (
                              <Flex gap="2" wrap="wrap">
                                {enabledRecipes.slice(0, 3).map((recipe) => (
                                  <Badge
                                    key={recipe}
                                    label={recipe}
                                    color="blue"
                                    variant="soft"
                                  />
                                ))}
                                {enabledRecipes.length > 3 && (
                                  <Badge
                                    label={`+${enabledRecipes.length - 3} more`}
                                    color="gray"
                                    variant="soft"
                                  />
                                )}
                              </Flex>
                            );
                          })()}
                        </TableCell>
                        <TableCell>
                          <Badge
                            label={
                              slackIntegration.enabled ? "Enabled" : "Disabled"
                            }
                            color={slackIntegration.enabled ? "green" : "gray"}
                            variant="soft"
                          />
                        </TableCell>
                        <TableCell>
                          {slackIntegration.lastRunAt
                            ? ago(slackIntegration.lastRunAt)
                            : "No runs"}
                        </TableCell>
                        <TableCell>
                          <Flex gap="2" justify="end">
                            <LinkButton
                              href={`/settings/webhooks/event/${slackIntegration.eventWebHookId}`}
                              variant="outline"
                              color="gray"
                              icon={<PiGearSix />}
                            >
                              Configure
                            </LinkButton>
                            <Button
                              variant="outline"
                              color="red"
                              icon={<PiTrash />}
                              aria-label={`Delete ${getSlackChannelLabel(
                                slackIntegration,
                              )}`}
                              onClick={() =>
                                deleteIntegration(slackIntegration)
                              }
                            >
                              Delete
                            </Button>
                          </Flex>
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell colSpan={6}>
                          <SlackNotificationRecipesPanel
                            slackIntegration={slackIntegration}
                            saving={savingPresetFor === slackIntegration.id}
                            error={
                              recipeErrorFor?.id === slackIntegration.id
                                ? recipeErrorFor.message
                                : null
                            }
                            onRecipeChange={updateRecipe}
                            onApplyRecommended={applyRecommended}
                            onCustomize={(slackIntegration, recipe) =>
                              setCustomizeRecipe({ slackIntegration, recipe })
                            }
                          />
                        </TableCell>
                      </TableRow>
                    </React.Fragment>
                  ))}
                </TableBody>
              </Table>
            )}
          </>
        )}
      </Flex>
    </div>
  );
};

export default SlackIntegrationsPage;
