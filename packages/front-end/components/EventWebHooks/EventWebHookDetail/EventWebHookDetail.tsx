import { EventWebHookInterface } from "back-end/types/event-webhook";
import React, { FC, useCallback, useState } from "react";
import pick from "lodash/pick";
import { TbWebhook } from "react-icons/tb";
import { FaAngleLeft, FaPencilAlt } from "react-icons/fa";
import classNames from "classnames";
import { useRouter } from "next/router";
import Link from "next/link";
import { HiOutlineClipboard, HiOutlineClipboardCheck } from "react-icons/hi";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useAuth } from "@/services/auth";
import { EventWebHookEditParams, useIconForState } from "../utils";
import { datetime } from "../../../services/dates";
import { useCopyToClipboard } from "../../../hooks/useCopyToClipboard";
import { SimpleTooltip } from "../../SimpleTooltip/SimpleTooltip";
import useApi from "../../../hooks/useApi";
import { EventWebHookAddEditModal } from "../EventWebHookAddEditModal/EventWebHookAddEditModal";

type EventWebHookDetailProps = {
  eventWebHook: EventWebHookInterface;
  onEdit: (data: EventWebHookEditParams) => Promise<void>;
  onDelete: () => Promise<void>;
  onEditModalOpen: () => void;
  onModalClose: () => void;
  isModalOpen: boolean;
  editError: string | null;
};

export const EventWebHookDetail: FC<EventWebHookDetailProps> = ({
  eventWebHook,
  onEdit,
  onDelete,
  onEditModalOpen,
  onModalClose,
  isModalOpen,
  editError,
}) => {
  const { lastState, lastRunAt, url, events, name, signingKey } = eventWebHook;

  const iconForState = useIconForState(eventWebHook.lastState);

  const { performCopy, copySuccess, copySupported } = useCopyToClipboard({
    timeout: 1500,
  });

  return (
    <div>
      <div className="mb-3">
        <Link href="/settings/webhooks">
          <a>
            <FaAngleLeft /> All Webhooks
          </a>
        </Link>
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

        <div className="d-flex align-items-center mt-2">
          <span className="text-muted ml-1 mr-2" style={{ fontSize: "1rem" }}>
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

      {isModalOpen ? (
        <EventWebHookAddEditModal
          isOpen={isModalOpen}
          onClose={onModalClose}
          onSubmit={onEdit}
          error={editError}
          mode={{ mode: "edit", data: eventWebHook }}
        />
      ) : null}
    </div>
  );
};

export const EventWebHookDetailContainer = () => {
  const router = useRouter();
  const { eventwebhookid: eventWebHookId } = router.query;

  const { apiCall } = useAuth();

  const { data, error, mutate } = useApi<{
    eventWebHook: EventWebHookInterface;
  }>(`/event-webhooks/${eventWebHookId}`);

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
            body: JSON.stringify(pick(data, ["events", "name", "url"])),
          }
        );

        if (response.error) {
          handleUpdateError(response.error || "Unknown error");
        } else {
          mutate();
          setEditError(null);
        }
      } catch (e) {
        handleUpdateError("Unknown error");
      }
    },
    [mutate, apiCall, eventWebHookId]
  );

  const handleDelete = useCallback(async () => {
    if (!router) return;
    if (!eventWebHookId) return;

    await apiCall(`/event-webhooks/${eventWebHookId}`, {
      method: "DELETE",
    });

    router.replace("/settings/webhooks");
  }, [eventWebHookId, apiCall, router]);

  if (error) {
    return (
      <div className="alert alert-danger">
        Unable to fetch event web hook {eventWebHookId}
      </div>
    );
  }

  if (!data) {
    return null;
  }

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
      eventWebHook={data.eventWebHook}
      editError={editError}
    />
  );
};
