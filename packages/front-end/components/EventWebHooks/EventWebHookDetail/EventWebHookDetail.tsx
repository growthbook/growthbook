import { EventWebHookInterface } from "shared/types/event-webhook";
import React, { FC, useRef, useCallback, useState } from "react";
import pick from "lodash/pick";
import { useRouter } from "next/router";
import { HiOutlineClipboard, HiOutlineClipboardCheck } from "react-icons/hi";
import { PiPencilSimpleFill } from "react-icons/pi";
import { BsThreeDotsVertical } from "react-icons/bs";
import { datetime } from "shared/dates";
import { Flex, Box, IconButton } from "@radix-ui/themes";
import Text from "@/ui/Text";
import { useAuth } from "@/services/auth";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { useEventWebhookLogs } from "@/hooks/useEventWebhookLogs";
import {
  EventWebHookEditParams,
  useIconForState,
  WebhookIcon,
  displayedEvents,
} from "@/components/EventWebHooks/utils";
import { EventWebHookAddEditModal } from "@/components/EventWebHooks/EventWebHookAddEditModal/EventWebHookAddEditModal";
import { useDefinitions } from "@/services/DefinitionsContext";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Badge from "@/ui/Badge";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";

type EventWebHookDetailProps = {
  eventWebHook: EventWebHookInterface;
  mutateEventWebHook: () => void;
  onEdit: (data: EventWebHookEditParams) => Promise<void>;
  onDelete: () => Promise<void>;
  onEditModalOpen: () => void;
  onModalClose: () => void;
  isModalOpen: boolean;
  editError: string | null;
};

type State =
  | { type: "danger"; message: string }
  | { type: "success"; message: string }
  | { type: "loading" }
  | undefined;

export const EventWebHookDetail: FC<EventWebHookDetailProps> = ({
  eventWebHook,
  mutateEventWebHook,
  onEdit,
  onDelete,
  onEditModalOpen,
  onModalClose,
  isModalOpen,
  editError,
}) => {
  const { getProjectById } = useDefinitions();
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const {
    id: webhookId,
    lastRunAt,
    payloadType,
    enabled,
    environments = [],
    projects: projectIds,
    tags = [],
    events,
    name,
    signingKey,
  } = eventWebHook;

  const defined = <T,>(v: T): v is NonNullable<T> => !!v;
  const projects = (projectIds || []).map(getProjectById).filter(defined);

  const { apiCall } = useAuth();
  const { mutate: mutateEventLogs } = useEventWebhookLogs(webhookId);
  const [state, setStateRaw] = useState<State>();
  const stateTimeout = useRef<undefined | ReturnType<typeof setTimeout>>();

  const setState = useCallback((state: State) => {
    setStateRaw(state);
    if (stateTimeout.current) clearTimeout(stateTimeout.current);
    stateTimeout.current = setTimeout(() => setStateRaw(undefined), 1500);
  }, []);

  const iconForState = useIconForState(eventWebHook.lastState);

  const { performCopy, copySuccess, copySupported } = useCopyToClipboard({
    timeout: 1500,
  });

  const onToggleWebhook = useCallback(async () => {
    setState({ type: "loading" });
    try {
      const response = await apiCall<{ enabled: boolean; error?: string }>(
        "/event-webhooks/toggle",
        { method: "POST", body: JSON.stringify({ webhookId }) },
      );
      if (response.error) {
        setState({
          type: "danger",
          message: `Failed to enable or disable webhook: ${response.error}`,
        });
        return;
      }
      setState({
        type: "success",
        message: `Webhook ${response.enabled ? "enabled" : "disabled"}`,
      });
      mutateEventWebHook();
    } catch (e) {
      setState({ type: "danger", message: "Unknown error" });
    }
  }, [mutateEventWebHook, webhookId, apiCall, setState]);

  const onTestWebhook = useCallback(async () => {
    setState({ type: "loading" });
    try {
      const response = await apiCall<{ error?: string }>(
        "/event-webhooks/test",
        { method: "POST", body: JSON.stringify({ webhookId }) },
      );
      if (response.error) {
        setState({
          type: "danger",
          message: `Failed to test webhook: ${response.error || "Unknown error"}`,
        });
        return;
      }
      setState({ type: "success", message: "Test event successfully sent!" });
      setTimeout(() => {
        mutateEventLogs();
        mutateEventWebHook();
      }, 1500);
    } catch (e) {
      setState({ type: "danger", message: "Unknown error" });
    }
  }, [setState, mutateEventLogs, mutateEventWebHook, webhookId, apiCall]);

  if (!payloadType) return null;

  const loading = state?.type === "loading";

  return (
    <Box>
      {state && state.type !== "loading" && (
        <Callout status={state.type === "success" ? "success" : "error"} mb="3">
          {state.message}
        </Callout>
      )}

      <Flex align="center" justify="between" mb="3">
        <Flex align="center" gap="3">
          <Box p="2" className="border rounded">
            <WebhookIcon
              type={payloadType}
              style={{ height: "2rem", width: "2rem" }}
            />
          </Box>
          <Text as="div" size="x-large" weight="semibold">
            {name}
          </Text>
          {enabled && <Badge label="Enabled" color="gray" variant="soft" />}
        </Flex>

        <Flex align="center" gap="4">
          <Button icon={<PiPencilSimpleFill />} onClick={onEditModalOpen}>
            Edit
          </Button>

          <DropdownMenu
            trigger={
              <IconButton
                variant="ghost"
                color="gray"
                radius="full"
                size="2"
                highContrast
              >
                <BsThreeDotsVertical size={18} />
              </IconButton>
            }
            open={dropdownOpen}
            onOpenChange={setDropdownOpen}
            menuPlacement="end"
            variant="soft"
          >
            <DropdownMenuGroup>
              <DropdownMenuItem
                disabled={loading}
                onClick={() => {
                  onTestWebhook();
                  setDropdownOpen(false);
                }}
              >
                Send Test
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={loading}
                onClick={() => {
                  onToggleWebhook();
                  setDropdownOpen(false);
                }}
              >
                {enabled ? "Disable" : "Enable"}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                color="red"
                disabled={loading}
                confirmation={{
                  confirmationTitle: "Delete Webhook",
                  cta: "Delete",
                  submitColor: "danger",
                  submit: async () => {
                    await onDelete();
                    setDropdownOpen(false);
                  },
                }}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenu>
        </Flex>
      </Flex>

      <Box ml="2">
        {!lastRunAt ? (
          <Text color="text-low">No runs</Text>
        ) : (
          <Flex align="center" gap="2">
            <Text weight="semibold">Last run:</Text>
            <Text>{datetime(lastRunAt)}</Text>
            <span style={{ fontSize: "1.5rem" }}>{iconForState}</span>
          </Flex>
        )}
      </Box>

      {["raw", "json"].includes(payloadType) && (
        <Flex align="center" gap="2" ml="2" mt="2">
          <Text weight="semibold">Secret:</Text>
          <code className="text-main text-break">{signingKey}</code>
          {copySupported && (
            <IconButton
              variant="ghost"
              color="gray"
              size="1"
              onClick={() => performCopy(signingKey)}
              aria-label="Copy signing key"
            >
              {copySuccess ? (
                <HiOutlineClipboardCheck />
              ) : (
                <HiOutlineClipboard />
              )}
            </IconButton>
          )}
        </Flex>
      )}

      <Box className="card mt-3 p-3 p-4">
        <div className="row">
          <div className="col-xs-12 col-md-6">
            <Box mt="2">
              <Text weight="semibold">Events enabled</Text>
              <Box mt="1">{displayedEvents(events)}</Box>
            </Box>
          </div>
        </div>

        <div className="row mt-4">
          <div className="col mt-2 mt-md-0">
            <Box mt="2">
              <Text weight="semibold" as="div" mb="1">
                Environments
              </Text>
              {environments.length ? (
                <Flex gap="2" wrap="wrap">
                  {environments.map((env) => (
                    <Badge
                      key={env}
                      label={env}
                      color="purple"
                      variant="soft"
                    />
                  ))}
                </Flex>
              ) : (
                <Text color="text-low" fontStyle="italic">
                  All
                </Text>
              )}
            </Box>
          </div>

          <div className="col mt-2 mt-md-0">
            <Box mt="2">
              <Text weight="semibold" as="div" mb="1">
                Projects
              </Text>
              {projects.length ? (
                <Flex gap="2" wrap="wrap">
                  {projects.map((proj) => (
                    <Badge
                      key={proj.id}
                      label={proj.name}
                      color="purple"
                      variant="soft"
                    />
                  ))}
                </Flex>
              ) : (
                <Text color="text-low" fontStyle="italic">
                  All
                </Text>
              )}
            </Box>
          </div>

          <div className="col mt-2 mt-md-0">
            <Box mt="2">
              <Text weight="semibold" as="div" mb="1">
                Tags
              </Text>
              {tags.length ? (
                <Flex gap="2" wrap="wrap">
                  {tags.map((tag) => (
                    <Badge
                      key={tag}
                      label={tag}
                      color="purple"
                      variant="soft"
                    />
                  ))}
                </Flex>
              ) : (
                <Text color="text-low" fontStyle="italic">
                  All
                </Text>
              )}
            </Box>
          </div>
        </div>
      </Box>

      {isModalOpen ? (
        <EventWebHookAddEditModal
          isOpen={isModalOpen}
          onClose={onModalClose}
          onSubmit={onEdit}
          error={editError}
          mode={{
            mode: "edit",
            data: {
              ...eventWebHook,
              events: eventWebHook.events,
              headers: eventWebHook.headers
                ? JSON.stringify(eventWebHook.headers)
                : "{}",
            },
          }}
        />
      ) : null}
    </Box>
  );
};

export const EventWebHookDetailContainer = ({
  eventWebHook,
  mutateEventWebHook,
}: {
  eventWebHook: EventWebHookInterface;
  mutateEventWebHook: () => void;
}) => {
  const router = useRouter();
  const { eventwebhookid: eventWebHookId } = router.query;

  const { apiCall } = useAuth();

  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);

  const handleEdit = useCallback(
    async (data: EventWebHookEditParams) => {
      if (!eventWebHookId) return;

      const response = await apiCall<{ error?: string; status?: number }>(
        `/event-webhooks/${eventWebHookId}`,
        {
          method: "PUT",
          body: JSON.stringify(
            pick(data, [
              "events",
              "name",
              "url",
              "enabled",
              "payloadType",
              "projects",
              "tags",
              "environments",
              "method",
              "headers",
            ]),
          ),
        },
      );

      if (response.error) {
        throw new Error(response.error);
      }

      mutateEventWebHook();
    },
    [mutateEventWebHook, apiCall, eventWebHookId],
  );

  const handleDelete = useCallback(async () => {
    if (!router) return;
    if (!eventWebHookId) return;

    await apiCall(`/event-webhooks/${eventWebHookId}`, {
      method: "DELETE",
    });

    router.replace("/settings/webhooks");
  }, [eventWebHookId, apiCall, router]);

  return (
    <EventWebHookDetail
      isModalOpen={isEditModalOpen}
      onEdit={handleEdit}
      onDelete={handleDelete}
      onEditModalOpen={() => setIsEditModalOpen(true)}
      onModalClose={() => setIsEditModalOpen(false)}
      eventWebHook={eventWebHook}
      editError={null}
      mutateEventWebHook={mutateEventWebHook}
    />
  );
};
