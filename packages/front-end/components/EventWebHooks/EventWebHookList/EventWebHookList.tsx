import React, { FC, useCallback, useState } from "react";
import { EventWebHookInterface } from "back-end/types/event-webhook";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { EventWebHookEditParams } from "@/components/EventWebHooks/utils";
import { EventWebHookAddEditModal } from "@/components/EventWebHooks/EventWebHookAddEditModal/EventWebHookAddEditModal";
import { docUrl, DocLink } from "@/components/DocLink";
import Button from "@/ui/Button";
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
        <div className="d-flex align-items-center">
          <h2>Event Webhooks</h2>
          <div className="ml-auto">
            <Button onClick={onCreateModalOpen}>New Event Webhook</Button>
          </div>
        </div>
        <p>
          Monitor specific events globally accross features and experiments.
          <span className="ml-2">
            <DocLink docSection={"eventWebhooks"}>
              View Documentation &gt;
            </DocLink>
          </span>
        </p>
      </div>

      {/* Feedback messages */}
      {errorMessage && (
        <div className="alert alert-danger my-3">{errorMessage}</div>
      )}

      {/* Empty state*/}
      {eventWebHooks.length === 0 && (
        <div className="row">
          <div className="col" />
          <div className="col-4 d-flex flex-column justify-content-center text-center">
            <h2>Monitor Specific Events</h2>
            <p>
              Send targeted notifications to popular apps like Discord and
              Slack. Apply globally for all features and experiments, or filter
              by environment, project, or tags.
            </p>
            <div className="d-flex">
              <Button
                mr="2"
                variant="outline"
                onClick={() => window.open(docUrl("eventWebhooks"), "_blank")}
              >
                Setup Instructions
              </Button>
              <Button onClick={onCreateModalOpen}>New Event Webhook</Button>
            </div>
          </div>
          <div className="col" />
        </div>
      )}

      {eventWebHooks.length > 0 && (
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
        </div>
      )}
    </div>
  );
};

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
          setIsModalOpen(false);
          mutate();
        }
      } catch (e) {
        setIsModalOpen(true);
        handleCreateError("Unknown error");
      }
    },
    [mutate, apiCall],
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
