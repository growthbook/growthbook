import React, { useEffect, useMemo, useState } from "react";
import { NextPage } from "next";
import { EventWebHookInterface } from "shared/types/event-webhook";
import { Box, Flex } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useApi from "@/hooks/useApi";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import SelectField from "@/components/Forms/SelectField";

type SlackTextObject = {
  type: "mrkdwn" | "plain_text";
  text: string;
};

type SlackBlock = {
  type: string;
  text?: SlackTextObject;
  fields?: SlackTextObject[];
  elements?: (
    | SlackTextObject
    | {
        type: "image";
        image_url: string;
        alt_text: string;
      }
  )[];
};

type SlackMessage = {
  text: string;
  blocks: SlackBlock[];
};

type SlackEventWebhookTestResult =
  | {
      ok: true;
      eventId: string;
      eventWebHookId: string;
      eventName: string;
      slackMessage: SlackMessage;
    }
  | { ok: false; error: string };

type SlackEventWebhookPreviewResult =
  | {
      ok: true;
      previews: {
        eventName: string;
        slackMessage: SlackMessage;
      }[];
    }
  | { ok: false; error: string };

const TEST_EVENT_OPTIONS = [
  { label: "Feature created", value: "feature.created" },
  { label: "Feature updated", value: "feature.updated" },
  { label: "Feature deleted", value: "feature.deleted" },
  { label: "Safe rollout ready to ship", value: "feature.saferollout.ship" },
  {
    label: "Safe rollout should roll back",
    value: "feature.saferollout.rollback",
  },
  {
    label: "Safe rollout unhealthy",
    value: "feature.saferollout.unhealthy",
  },
  {
    label: "Ramp schedule created",
    value: "feature.rampSchedule.created",
  },
  {
    label: "Ramp schedule deleted",
    value: "feature.rampSchedule.deleted",
  },
  {
    label: "Ramp schedule started",
    value: "feature.rampSchedule.actions.started",
  },
  {
    label: "Ramp schedule completed",
    value: "feature.rampSchedule.actions.completed",
  },
  {
    label: "Ramp schedule rolled back",
    value: "feature.rampSchedule.actions.rolledBack",
  },
  {
    label: "Ramp schedule jumped",
    value: "feature.rampSchedule.actions.jumped",
  },
  {
    label: "Ramp schedule step advanced",
    value: "feature.rampSchedule.actions.step.advanced",
  },
  {
    label: "Ramp schedule approval required",
    value: "feature.rampSchedule.actions.step.approvalRequired",
  },
  { label: "Feature revision created", value: "feature.revision.created" },
  { label: "Feature revision updated", value: "feature.revision.updated" },
  {
    label: "Feature revision review requested",
    value: "feature.revision.reviewRequested",
  },
  { label: "Feature revision approved", value: "feature.revision.approved" },
  {
    label: "Feature revision changes requested",
    value: "feature.revision.changesRequested",
  },
  { label: "Feature revision commented", value: "feature.revision.commented" },
  { label: "Feature revision discarded", value: "feature.revision.discarded" },
  { label: "Feature revision rebased", value: "feature.revision.rebased" },
  { label: "Feature revision published", value: "feature.revision.published" },
  { label: "Feature revision reverted", value: "feature.revision.reverted" },
  { label: "Experiment created", value: "experiment.created" },
  { label: "Experiment updated", value: "experiment.updated" },
  { label: "Experiment deleted", value: "experiment.deleted" },
  { label: "Experiment warning", value: "experiment.warning" },
  {
    label: "Experiment metric significance",
    value: "experiment.info.significance",
  },
  { label: "Experiment decision - ship", value: "experiment.decision.ship" },
  {
    label: "Experiment decision - rollback",
    value: "experiment.decision.rollback",
  },
  {
    label: "Experiment decision - review",
    value: "experiment.decision.review",
  },
  { label: "Experiment started", value: "experiment.started" },
  {
    label: "Experiment stopped - shipped",
    value: "experiment.stopped.shipped",
  },
  {
    label: "Experiment stopped - rolled back",
    value: "experiment.stopped.rolledback",
  },
  {
    label: "Experiment health - guardrail failed",
    value: "experiment.health.guardrailFailed",
  },
  { label: "Experiment health - no data", value: "experiment.health.noData" },
  {
    label: "Experiment health - query failed",
    value: "experiment.health.queryFailed",
  },
];

const TEST_EVENT_LABELS = new Map(
  TEST_EVENT_OPTIONS.map((option) => [option.value, option.label]),
);

const getBlockKitBuilderUrl = (slackMessage: SlackMessage) =>
  `https://app.slack.com/block-kit-builder/#${encodeURIComponent(
    JSON.stringify(slackMessage),
  )}`;

const renderMrkdwn = (text: string) => {
  const nodes: React.ReactNode[] = [];
  const tokenRegex = /(<https?:\/\/[^|>]+\|[^>]+>)|(`[^`]+`)|(\*[^*\n]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text))) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith("<")) {
      const [href, label] = token.slice(1, -1).split("|");
      nodes.push(
        <a key={nodes.length} href={href} target="_blank" rel="noreferrer">
          {label || href}
        </a>,
      );
    } else if (token.startsWith("`")) {
      nodes.push(<code key={nodes.length}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("*")) {
      nodes.push(<strong key={nodes.length}>{token.slice(1, -1)}</strong>);
    }

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
};

const SlackText = ({
  text,
  size = 14,
  color = "#d1d2d3",
}: {
  text: SlackTextObject;
  size?: number;
  color?: string;
}) => (
  <div
    style={{
      color,
      fontSize: size,
      lineHeight: 1.45,
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
    }}
  >
    {text.type === "mrkdwn" ? renderMrkdwn(text.text) : text.text}
  </div>
);

const SlackBlockKitPreview = ({ message }: { message: SlackMessage }) => (
  <Box
    p="4"
    style={{
      background: "#1d1c1d",
      border: "1px solid #3f3f46",
      borderRadius: 10,
      color: "#d1d2d3",
      fontFamily: "Slack-Lato, Slack-Fractions, appleLogo, sans-serif",
      maxWidth: 820,
    }}
  >
    <Flex direction="column" gap="3">
      {message.blocks.map((block, index) => {
        if (block.type === "divider") {
          return (
            <div
              key={index}
              style={{ borderTop: "1px solid #3f3f46", margin: "4px 0" }}
            />
          );
        }

        if (block.type === "header" && block.text) {
          return (
            <SlackText
              key={index}
              text={block.text}
              size={18}
              color="#f8f8f8"
            />
          );
        }

        if (block.type === "context" && block.elements) {
          return (
            <Flex key={index} gap="2" align="center" wrap="wrap">
              {block.elements.map((element, elementIndex) => {
                if (element.type === "image") {
                  return (
                    <img
                      key={elementIndex}
                      src={element.image_url}
                      alt={element.alt_text}
                      style={{ width: 16, height: 16, borderRadius: 3 }}
                    />
                  );
                }

                return (
                  <SlackText
                    key={elementIndex}
                    text={element}
                    size={12}
                    color="#ababad"
                  />
                );
              })}
            </Flex>
          );
        }

        if (block.type === "section") {
          return (
            <Flex key={index} direction="column" gap="2">
              {block.text && <SlackText text={block.text} />}
              {block.fields && block.fields.length > 0 && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: 12,
                  }}
                >
                  {block.fields.map((field, fieldIndex) => (
                    <SlackText key={fieldIndex} text={field} />
                  ))}
                </div>
              )}
            </Flex>
          );
        }

        return (
          <pre
            key={index}
            style={{
              color: "#d1d2d3",
              fontSize: 12,
              margin: 0,
              whiteSpace: "pre-wrap",
            }}
          >
            {JSON.stringify(block, null, 2)}
          </pre>
        );
      })}
    </Flex>
  </Box>
);

const SlackTestPage: NextPage = () => {
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const [eventWebHookId, setEventWebHookId] = useState("");
  const [loadingEventName, setLoadingEventName] = useState<string | null>(null);
  const [result, setResult] = useState<SlackEventWebhookTestResult | null>(
    null,
  );

  const { data, error } = useApi<{
    eventWebHooks: EventWebHookInterface[];
  }>("/event-webhooks");
  const { data: previewData, error: previewError } =
    useApi<SlackEventWebhookPreviewResult>(
      "/admin/slack-test/event-webhook/previews",
    );

  const slackEventWebHooks = useMemo(
    () =>
      (data?.eventWebHooks || []).filter(
        (eventWebHook) => eventWebHook.payloadType === "slack",
      ),
    [data],
  );

  useEffect(() => {
    if (!eventWebHookId && slackEventWebHooks[0]) {
      setEventWebHookId(slackEventWebHooks[0].id);
    }
  }, [eventWebHookId, slackEventWebHooks]);

  if (!permissionsUtil.canCreateEventWebhook()) {
    return (
      <div className="container-fluid pagecontents">
        <Callout status="error">
          You do not have access to view this page.
        </Callout>
      </div>
    );
  }

  const onSend = async (eventName: string) => {
    setLoadingEventName(eventName);
    setResult(null);
    try {
      const response = await apiCall<SlackEventWebhookTestResult>(
        "/admin/slack-test/event-webhook",
        {
          method: "POST",
          body: JSON.stringify({ eventWebHookId, eventName }),
        },
      );
      setResult(response);
    } catch (e) {
      setResult({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoadingEventName(null);
    }
  };

  return (
    <div className="container-fluid pagecontents">
      <Box p="4">
        <Heading as="h1" mb="2">
          Slack Event Webhook test
        </Heading>
        <Box mb="4">
          Preview every synthetic Slack notification and optionally queue one
          through an existing Event Webhook. Delivery, formatting, logs, and
          retries use the same path as production event webhooks.
        </Box>

        {error && (
          <Callout status="error" mb="3">
            Unable to load Event Webhooks: {error.message}
          </Callout>
        )}

        {previewError && (
          <Callout status="error" mb="3">
            Unable to load Slack previews: {previewError.message}
          </Callout>
        )}

        {!error && data && slackEventWebHooks.length === 0 && (
          <Callout status="warning" mb="3">
            Create an Event Webhook with payload type Slack under Settings -
            Webhooks before using this test.
          </Callout>
        )}

        <Flex direction="column" gap="5">
          <SelectField
            label="Slack Event Webhook"
            value={eventWebHookId}
            onChange={setEventWebHookId}
            options={slackEventWebHooks.map((eventWebHook) => ({
              label: `${eventWebHook.name}${
                eventWebHook.enabled ? "" : " (disabled)"
              }`,
              value: eventWebHook.id,
            }))}
            placeholder="Choose Event Webhook"
            disabled={!slackEventWebHooks.length}
          />

          {result?.ok && (
            <Callout status="success">
              Queued <code>{result.eventName}</code> for{" "}
              <code>{result.eventWebHookId}</code>. Event:{" "}
              <code>{result.eventId}</code>
              <br />
              <a
                href={getBlockKitBuilderUrl(result.slackMessage)}
                target="_blank"
                rel="noreferrer"
              >
                Open preview in Block Kit Builder
              </a>
            </Callout>
          )}
          {result && !result.ok && (
            <Callout status="error">{result.error}</Callout>
          )}

          {!previewData && !previewError && (
            <Callout status="info">Loading Slack previews.</Callout>
          )}

          {previewData?.ok === false && (
            <Callout status="error">{previewData.error}</Callout>
          )}

          {previewData?.ok && (
            <Flex direction="column" gap="5">
              {previewData.previews.map((preview) => (
                <Box
                  key={preview.eventName}
                  p="4"
                  style={{
                    border: "1px solid var(--gray-a5)",
                    borderRadius: "var(--radius-3)",
                  }}
                >
                  <Flex direction="column" gap="3">
                    <Flex align="center" justify="between" gap="3" wrap="wrap">
                      <Box>
                        <Heading as="h2" size="small" mb="1">
                          {TEST_EVENT_LABELS.get(preview.eventName) ||
                            preview.eventName}
                        </Heading>
                        <code>{preview.eventName}</code>
                      </Box>
                      <Flex gap="2">
                        <Button
                          variant="outline"
                          onClick={() => onSend(preview.eventName)}
                          disabled={!eventWebHookId || !!loadingEventName}
                        >
                          {loadingEventName === preview.eventName
                            ? "Queueing..."
                            : "Queue Test Event"}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() =>
                            window.open(
                              getBlockKitBuilderUrl(preview.slackMessage),
                              "_blank",
                              "noreferrer",
                            )
                          }
                        >
                          Block Kit Builder
                        </Button>
                      </Flex>
                    </Flex>

                    <SlackBlockKitPreview message={preview.slackMessage} />
                  </Flex>
                </Box>
              ))}
            </Flex>
          )}
        </Flex>
      </Box>
    </div>
  );
};

export default SlackTestPage;
