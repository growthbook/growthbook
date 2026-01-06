import { EventWebHookInterface } from "shared/types/event-webhook";
import React, { FC, useRef, useCallback, useState } from "react";
import pick from "lodash/pick";
import { FaPencilAlt } from "react-icons/fa";
import { useRouter } from "next/router";
import { HiOutlineClipboard, HiOutlineClipboardCheck } from "react-icons/hi";
import { datetime } from "shared/dates";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
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
import MoreMenu from "@/components/Dropdown/MoreMenu";
import { useDefinitions } from "@/services/DefinitionsContext";

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
  | {
      type: "danger";
      message: string;
    }
  | {
      type: "success";
      message: string;
    }
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

  const setState = useCallback((state) => {
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
      const response = await apiCall<{
        enabled: boolean;
        error?: string;
      }>("/event-webhooks/toggle", {
        method: "POST",
        body: JSON.stringify({ webhookId }),
      });

      if (response.error) {
        setState({
          type: "danger",
          message: `Failed to enable or disable webhook: ${response.error}`,
        });
        return;
      }

      setState({
        type: "success",
        message: `Wehook ${response.enabled ? "enabled" : "disabled"}`,
      });

      mutateEventWebHook();
    } catch (e) {
      setState({ type: "danger", message: "Unknown error" });
    }
  }, [mutateEventWebHook, webhookId, apiCall, setState]);

  const onTestWebhook = useCallback(async () => {
    setState({ type: "loading" });

    try {
      const response = await apiCall<{
        error?: string;
      }>("/event-webhooks/test", {
        method: "POST",
        body: JSON.stringify({ webhookId }),
      });

      if (response.error) {
        setState({
          type: "danger",
          message: `Failed to test webhook: ${
            response.error || "Unknown error"
          }`,
        });
        return;
      }

      setState({ type: "success", message: "Test event sucessfully sent!" });

      setTimeout(() => {
        mutateEventLogs();
        mutateEventWebHook();
      }, 1500);
    } catch (e) {
      setState({ type: "danger", message: "Unknown error" });
    }
  }, [setState, mutateEventLogs, mutateEventWebHook, webhookId, apiCall]);

  if (!payloadType) return null;

  return (
    <div>
      <div className="d-sm-flex mb-3 justify-content-between">
        {state && state.type !== "loading" && (
          <div className={`p-sm-1 mb-0 alert alert-${state.type}`}>
            {state.message}
          </div>
        )}
      </div>

      <div className="justify-content-between mb-3 mb-sm-0">
        <div className="d-flex align-items-center">
          {/* Title */}
          <div className="m-2 p-2 border rounded">
            <WebhookIcon
              type={payloadType}
              style={{ height: "2rem", width: "2rem" }}
            />
          </div>
          <h1 className="mb-0">{name}</h1>
          {enabled && (
            <div>
              <span className="badge badge-gray text-uppercase ml-2 mb-0">
                Enabled
              </span>
            </div>
          )}

          <div className="ml-auto d-flex align-items-center">
            <button className="btn btn-primary" onClick={onEditModalOpen}>
              <FaPencilAlt className="mr-1" /> Edit
            </button>
            <MoreMenu className="ml-2">
              <button
                onClick={onTestWebhook}
                className="btn dropdown-item pb-2"
                disabled={state && state.type === "loading"}
              >
                Send Test
              </button>

              <button
                onClick={onToggleWebhook}
                className="btn dropdown-item pb-2"
                disabled={state && state.type === "loading"}
              >
                {enabled ? "Disable" : "Enable"}
              </button>

              <hr className="m-1" />
              <DeleteButton
                displayName="Webhook"
                onClick={onDelete}
                useIcon={false}
                className="dropdown-item text-danger"
                text="Delete"
                disabled={state && state.type === "loading"}
              />
            </MoreMenu>
          </div>
        </div>

        <div className="ml-2">
          {!lastRunAt ? (
            <div className="text-muted">No runs</div>
          ) : (
            <div className="text-main d-flex align-items-center">
              <b className="mr-1">Last run:</b> {datetime(lastRunAt)}
              <span className="ml-2" style={{ fontSize: "1.5rem" }}>
                {iconForState}
              </span>
            </div>
          )}
        </div>

        {["raw", "json"].includes(payloadType) && (
          <div className="ml-2 d-flex align-items-center">
            <div className="text-main">
              <b>Secret:</b>
            </div>
            <span className="ml-1">
              <code className="text-main text-break">{signingKey}</code>
            </span>

            <span className="ml-2">
              {copySupported ? (
                <button
                  className="btn p-0 pb-1"
                  onClick={() => performCopy(signingKey)}
                >
                  <span className="text-main" style={{ fontSize: "1.1rem" }}>
                    {copySuccess ? (
                      <HiOutlineClipboardCheck />
                    ) : (
                      <HiOutlineClipboard />
                    )}
                  </span>
                </button>
              ) : null}
            </span>
          </div>
        )}
      </div>

      <div className="card mt-3 p-3 p-4">
        <div className="row">
          <div className="col-xs-12 col-md-6">
            <div className="align-items-center mt-2">
              <span className="font-weight-bold">Events enabled</span>
              <div className="mt-1">{displayedEvents(events)}</div>
            </div>
          </div>
        </div>

        <div className="row mt-4">
          <div className="col mt-2 mt-md-0">
            <div className="align-items-center mt-2">
              <div className="font-weight-bold mb-1">Environments</div>
              {environments.length ? (
                environments.map((env) => (
                  <span className="mr-2 badge badge-purple" key={env}>
                    {env}
                  </span>
                ))
              ) : (
                <span className="font-italic">All</span>
              )}
            </div>
          </div>

          <div className="col mt-2 mt-md-0">
            <div className="align-items-center mt-2">
              <div className="font-weight-bold mb-1">Projects</div>
              {projects.length ? (
                projects.map((proj) => (
                  <span className="mr-2 badge badge-purple" key={proj.id}>
                    {proj.name}
                  </span>
                ))
              ) : (
                <span className="font-italic">All</span>
              )}
            </div>
          </div>

          <div className="col mt-2 mt-md-0">
            <div className="align-items-center mt-2">
              <div className="font-weight-bold mb-1">Tags</div>
              {tags.length ? (
                tags.map((tag) => (
                  <span className="mr-2 badge badge-purple" key={tag}>
                    {tag}
                  </span>
                ))
              ) : (
                <span className="font-italic">All</span>
              )}
            </div>
          </div>
        </div>
      </div>

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
              headers: eventWebHook.headers
                ? JSON.stringify(eventWebHook.headers)
                : "{}",
            },
          }}
        />
      ) : null}
    </div>
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
  const [editError, setEditError] = useState<string | null>(null);

  const handleEdit = useCallback(
    async (data: EventWebHookEditParams) => {
      if (!eventWebHookId) return;

      // Keep the modal open and display error
      const handleUpdateError = (message: string) => {
        setEditError(`Failed to update webhook: ${message}`);
        setIsEditModalOpen(true);
      };

      try {
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
          handleUpdateError(response.error || "Unknown error");
        } else {
          mutateEventWebHook();
          setIsEditModalOpen(false);
          setEditError(null);
        }
      } catch (e) {
        handleUpdateError("Unknown error");
      }
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
      onEditModalOpen={() => {
        setIsEditModalOpen(true);
        setEditError(null);
      }}
      onModalClose={() => setIsEditModalOpen(false)}
      eventWebHook={eventWebHook}
      editError={editError}
      mutateEventWebHook={mutateEventWebHook}
    />
  );
};
