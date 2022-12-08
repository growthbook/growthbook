import React, { FC, PropsWithChildren, useCallback, useState } from "react";
import { FaBolt } from "react-icons/fa";
import { EventWebHookInterface } from "../../../../back-end/types/event-webhook";
import { EventWebHookListItem } from "./EventWebHookListItem/EventWebHookListItem";
import { EventWebHookEditParams } from "../utils";
import { EventWebHookAddEditModal } from "../EventWebHookAddEditModal/EventWebHookAddEditModal";
import useApi from "../../../hooks/useApi";
import { useAuth } from "../../../services/auth";

type EventWebHookListProps = {
  onCreateModalOpen: () => void;
  onModalClose: () => void;
  isModalOpen: boolean;
  onAdd: (data: EventWebHookEditParams) => void;
  eventWebHooks: EventWebHookInterface[];
  errorMessage: string | null;
};

export const EventWebHookList: FC<EventWebHookListProps> = ({
  eventWebHooks,
  isModalOpen,
  onAdd,
  onModalClose,
  onCreateModalOpen,
  errorMessage,
}) => {
  return (
    <div>
      {isModalOpen ? (
        <EventWebHookAddEditModal
          isOpen={isModalOpen}
          onClose={onModalClose}
          onSubmit={onAdd}
          mode={{ mode: "create" }}
        />
      ) : null}

      <div className="mb-4">
        <h1>Event Webhooks</h1>
        <p>
          Event Webhooks are event-based, and allow you to monitor specific
          events.
        </p>
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
                href="#"
                // href={`/settings/webhooks/${eventWebHook.id}`}
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

  const { data, error, mutate } = useApi<{
    eventWebHooks: EventWebHookInterface[];
  }>("/event-webhooks");

  const handleCreateModalOpen = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  const handleAdd = useCallback(
    async (data: EventWebHookEditParams) => {
      await apiCall("/event-webhooks", {
        method: "POST",
        body: JSON.stringify(data),
      });
      mutate();
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
    />
  );
};
