import React, { FC, PropsWithChildren, useCallback, useState } from "react";
import { FaBolt } from "react-icons/fa";
import { EventWebHookInterface } from "back-end/types/event-webhook";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { EventWebHookEditParams } from "../utils";
import { EventWebHookAddEditModal } from "../EventWebHookAddEditModal/EventWebHookAddEditModal";
import { EventWebHookListItem } from "./EventWebHookListItem/EventWebHookListItem";

type EventWebHookListProps = {
  onCreateModalOpen: () => void;
  onModalClose: () => void;
  isModalOpen: boolean;
  onAdd: (data: EventWebHookEditParams) => void;
  eventWebHooks: EventWebHookInterface[];
  errorMessage: string | null;
  createError: string | null;
};

export const EventWebHookList: FC<EventWebHookListProps> = ({
  eventWebHooks,
  isModalOpen,
  onAdd,
  onModalClose,
  onCreateModalOpen,
  errorMessage,
  createError,
}) => {
  return (
    <div>
      {isModalOpen ? (
        <EventWebHookAddEditModal
          isOpen={isModalOpen}
          onClose={onModalClose}
          onSubmit={onAdd}
          mode={{ mode: "create" }}
          error={createError}
        />
      ) : null}

      <div className="mb-4">
        <div className="d-flex justify-space-between align-items-center">
          <span className="badge badge-purple text-uppercase mr-2">Beta</span>
          <h1>Event Webhooks</h1>
        </div>
        <p>
          Event Webhooks are event-based, and allow you to monitor specific
          events.
        </p>
        <div className="alert alert-premium">
          <h4>Free while in Beta</h4>
          <p className="mb-0">
            This feature will be free while we build it out and work out the
            bugs.
          </p>
        </div>
      </div>

      {/* Feedback messages */}
      {errorMessage && (
        <div className="alert alert-danger my-3">{errorMessage}</div>
      )}

      {/* Empty state*/}
      {eventWebHooks.length === 0 ? (
        <EventWebHooksEmptyState>
          <button className="btn btn-primary" onClick={onCreateModalOpen}>
            <FaBolt />
            Create an Event Webhook
          </button>
        </EventWebHooksEmptyState>
      ) : (
        <div>
          {/* List view */}
          {eventWebHooks.map((eventWebHook) => (
            <div key={eventWebHook.id} className="mb-3">
              <EventWebHookListItem
                href={`/settings/webhooks/event/${eventWebHook.id}`}
                eventWebHook={eventWebHook}
              />
            </div>
          ))}

          <div className="mt-4">
            <button className="btn btn-primary" onClick={onCreateModalOpen}>
              <FaBolt />
              Create an Event Webhook
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const EventWebHooksEmptyState: FC<PropsWithChildren> = ({ children }) => (
  <div className="row">
    <div className="col-xs-12 col-md-6 offset-md-3">
      <div className="card text-center p-3">
        When Event Webhooks are created, they will show up here.
        <div className="mt-4">{children}</div>
      </div>
    </div>
  </div>
);

export const EventWebHookListContainer = () => {
  const { apiCall } = useAuth();
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);

  const [createError, setCreateError] = useState<string | null>(null);

  const { data, error, mutate } = useApi<{
    eventWebHooks: EventWebHookInterface[];
  }>("/event-webhooks");

  const handleCreateModalOpen = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  const handleAdd = useCallback(
    async (data: EventWebHookEditParams) => {
      // Keep the modal open and display error
      const handleCreateError = (message: string) => {
        setCreateError(`Failed to create webhook: ${message}`);
        setIsModalOpen(true);
      };

      try {
        const response = await apiCall<{
          error?: string;
          eventWebHook?: EventWebHookInterface;
        }>("/event-webhooks", {
          method: "POST",
          body: JSON.stringify(data),
        });

        if (response.error) {
          handleCreateError(response.error || "Unknown error");
        } else {
          setCreateError(null);
          mutate();
        }
      } catch (e) {
        setIsModalOpen(true);
        handleCreateError("Unknown error");
      }
    },
    [mutate, apiCall]
  );

  return (
    <EventWebHookList
      isModalOpen={isModalOpen}
      onModalClose={() => setIsModalOpen(false)}
      onCreateModalOpen={handleCreateModalOpen}
      eventWebHooks={data?.eventWebHooks || []}
      onAdd={handleAdd}
      errorMessage={error?.message || null}
      createError={createError}
    />
  );
};
