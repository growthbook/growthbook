import { EventWebHookInterface } from "back-end/types/event-webhook";
import React, { FC, useCallback, useState } from "react";
import pick from "lodash/pick";
import { TbWebhook } from "react-icons/tb";
import { FaAngleLeft, FaPencilAlt, FaPaperPlane } from "react-icons/fa";
import classNames from "classnames";
import { useRouter } from "next/router";
import Link from "next/link";
import { HiOutlineClipboard, HiOutlineClipboardCheck } from "react-icons/hi";
import { datetime } from "shared/dates";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useAuth } from "@/services/auth";
import Badge from "@/components/Badge";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { useEventWebhookLogs } from "@/hooks/useEventWebhookLogs";
import {
  EventWebHookEditParams,
  useIconForState,
} from "@/components/EventWebHooks/utils";
import { SimpleTooltip } from "@/components/SimpleTooltip/SimpleTooltip";
import { EventWebHookAddEditModal } from "@/components/EventWebHooks/EventWebHookAddEditModal/EventWebHookAddEditModal";

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
  const {
    id: webhookId,
    lastState,
    lastRunAt,
    url,
    events,
    name,
    signingKey,
  } = eventWebHook;

  const { apiCall } = useAuth();
  const { mutate: mutateEventLogs } = useEventWebhookLogs(webhookId);
  const [state, setState] = useState<State>();

  const iconForState = useIconForState(eventWebHook.lastState);

  const { performCopy, copySuccess, copySupported } = useCopyToClipboard({
    timeout: 1500,
  });

  const onTestWebhook = useCallback(async () => {
    setState({ type: "loading" });

    try {
      const response = await apiCall<{
        error?: string;
        eventId?: string;
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
      }, 1000);
    } catch (e) {
      setState({ type: "danger", message: "Unknown error" });
    }
  }, [mutateEventLogs, mutateEventWebHook, webhookId, apiCall]);

  return (
    <div>
      <div className="d-sm-flex mb-3 justify-content-between">
        <Link href="/settings/webhooks" className="p-sm-1">
          <FaAngleLeft />
          All Webhooks
        </Link>

        {state && state.type !== "loading" && (
          <div className={`p-sm-1 mb-0 alert alert-${state.type}`}>
            {state.message}
          </div>
        )}
      </div>

      <div className="d-sm-flex justify-content-between mb-3 mb-sm-0">
        <div>
          {/* Title */}
          <h1>{name}</h1>
        </div>

        <div>
          {/* Actions */}
          <button
            onClick={onEditModalOpen}
            className="btn btn-sm btn-outline-primary mr-1"
          >
            <FaPencilAlt className="mr-1" />
            Edit
          </button>

          <button
            onClick={onTestWebhook}
            className="btn btn-sm btn-outline-secondary mr-1"
            disabled={state && state.type === "loading"}
          >
            <FaPaperPlane className="mr-1" />
            Test
          </button>

          <DeleteButton
            displayName={name}
            onClick={onDelete}
            outline={true}
            className="btn-sm"
            text="Delete"
          />
        </div>
      </div>

      <h3 className="text-muted text-break font-weight-bold">{url}</h3>

      <div className="card mt-3 p-3">
        <div className="row">
          <div className="col-xs-12 col-md-6">
            <div className="d-flex font-weight-bold align-items-center">
              {/* Last run state & date */}
              <span className="mr-2" style={{ fontSize: "1.5rem" }}>
                {iconForState}
              </span>
              {lastRunAt ? (
                <span
                  className={classNames("", {
                    "text-success": lastState === "success",
                    "text-danger": lastState === "error",
                  })}
                >
                  Last run on {datetime(lastRunAt)}
                </span>
              ) : (
                <span className="text-muted">
                  This webhook has not yet run.
                </span>
              )}
            </div>
          </div>

          <div className="col-xs-12 col-md-6 mt-2 mt-md-0">
            <div className="d-flex align-items-center">
              {copySupported ? (
                <button
                  className="btn p-0"
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
              <span className="ml-3">
                <code className="text-main text-break">{signingKey}</code>
              </span>

              {copySuccess ? (
                <SimpleTooltip position="bottom">
                  Webhook secret copied to clipboard!
                </SimpleTooltip>
              ) : null}
            </div>
          </div>
        </div>

        <div className="row">
          <div className="col-xs-12 col-md-6">
            <div className="d-flex align-items-center mt-2">
              <span
                className="text-muted ml-1 mr-2"
                style={{ fontSize: "1rem" }}
              >
                <TbWebhook className="d-block" />
              </span>
              <span className="font-weight-bold">&nbsp;Events</span>
              <div className="flex-grow-1 d-flex flex-wrap ml-3">
                {events.map((eventName) => (
                  <span key={eventName} className="mr-2 badge badge-purple">
                    {eventName}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="col-xs-12 col-md-6">
            <div className="mt-2">
              {eventWebHook.enabled ? (
                <Badge className="badge-green" content="Webhook enabled" />
              ) : (
                <Badge className="badge-red" content="Webhook disabled" />
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
              tags: [],
              environments: [],
              projects: [],
              payloadType: "raw",
              method: "POST",
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
              ])
            ),
          }
        );

        if (response.error) {
          handleUpdateError(response.error || "Unknown error");
        } else {
          mutateEventWebHook();
          setEditError(null);
        }
      } catch (e) {
        handleUpdateError("Unknown error");
      }
    },
    [mutateEventWebHook, apiCall, eventWebHookId]
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
