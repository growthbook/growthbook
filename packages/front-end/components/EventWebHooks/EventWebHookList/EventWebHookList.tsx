import React, { FC, useCallback, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { EventWebHookInterface } from "shared/types/event-webhook";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { EventWebHookEditParams } from "@/components/EventWebHooks/utils";
import { EventWebHookAddEditModal } from "@/components/EventWebHooks/EventWebHookAddEditModal/EventWebHookAddEditModal";
import { docUrl, DocLink } from "@/components/DocLink";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import { SettingsPageHeader } from "@/components/Layout/SettingsPage";
import { EventWebHookListItem } from "./EventWebHookListItem/EventWebHookListItem";

type EventWebHookListProps = {
  onCreateModalOpen: () => void;
  onModalClose: () => void;
  isModalOpen: boolean;
  onAdd: (data: EventWebHookEditParams) => Promise<void>;
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
  const permissionsUtils = usePermissionsUtil();
  const canManageSlack = permissionsUtils.canManageIntegrations();

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

      <SettingsPageHeader
        title="Webhooks"
        description={
          <>
            Monitor specific events globally across features and experiments.{" "}
            <DocLink docSection="eventWebhooks">View docs</DocLink>
          </>
        }
        actions={<Button onClick={onCreateModalOpen}>New event webhook</Button>}
      />

      {/* Feedback messages */}
      {errorMessage && (
        <Callout status="error" my="3">
          {errorMessage}
        </Callout>
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
            <Flex justify="center" gap="2">
              <Button
                variant="outline"
                onClick={() => window.open(docUrl("eventWebhooks"), "_blank")}
              >
                Setup instructions
              </Button>
              <Button onClick={onCreateModalOpen}>New event webhook</Button>
            </Flex>
          </div>
          <div className="col" />
        </div>
      )}

      {eventWebHooks.length > 0 && (
        <div>
          {/* List view */}
          {eventWebHooks.map((eventWebHook) => {
            const managedInSlack =
              eventWebHook.payloadType === "slack" &&
              !!eventWebHook.slack?.teamId &&
              canManageSlack;
            const href = managedInSlack
              ? eventWebHook.slack?.channelId
                ? `/integrations/slack?channel=${encodeURIComponent(
                    eventWebHook.id,
                  )}`
                : `/integrations/slack?workspace=${encodeURIComponent(
                    eventWebHook.slack?.teamId || "",
                  )}`
              : `/settings/webhooks/event/${eventWebHook.id}`;

            return (
              <div key={eventWebHook.id} className="mb-3">
                <EventWebHookListItem href={href} eventWebHook={eventWebHook} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

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
      const response = await apiCall<{
        error?: string;
        eventWebHook?: EventWebHookInterface;
      }>("/event-webhooks", {
        method: "POST",
        body: JSON.stringify(data),
      });

      if (response.error) {
        throw new Error(response.error);
      }

      mutate();
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
      createError={null}
    />
  );
};
