import React, { FC, useCallback, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiArrowRight, PiPlus } from "react-icons/pi";
import { EventWebHookInterface } from "shared/types/event-webhook";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { EventWebHookEditParams } from "@/components/EventWebHooks/utils";
import { EventWebHookAddEditModal } from "@/components/EventWebHooks/EventWebHookAddEditModal/EventWebHookAddEditModal";
import { DocLink } from "@/components/DocLink";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import { SettingsPageHeader } from "@/components/Layout/SettingsPage";
import { EventWebHookListItem } from "./EventWebHookListItem/EventWebHookListItem";

type EventWebHookListProps = {
  onCreateModalOpen: () => void;
  onModalClose: () => void;
  isModalOpen: boolean;
  onAdd: (data: EventWebHookEditParams) => Promise<void>;
  eventWebHooks: EventWebHookInterface[];
  isLoaded: boolean;
  errorMessage: string | null;
  createError: string | null;
};

export const EventWebHookList: FC<EventWebHookListProps> = ({
  eventWebHooks,
  isLoaded,
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
        as="h2"
        title="Webhooks"
        actions={
          <Button icon={<PiPlus />} onClick={onCreateModalOpen}>
            Add webhook
          </Button>
        }
      />

      {/* Feedback messages */}
      {errorMessage && (
        <Callout status="error" my="3">
          {errorMessage}
        </Callout>
      )}

      {/* Empty state*/}
      {isLoaded && !errorMessage && eventWebHooks.length === 0 && (
        <Frame py="7">
          <Flex direction="column" align="center" gap="2">
            <Heading as="h3" size="lg">
              Monitor Specific Events
            </Heading>
            <Box maxWidth="560px">
              <Text as="p" align="center" color="text-mid" mb="2">
                Send targeted notifications to popular apps like Discord and
                Slack. Apply globally for all features and experiments, or
                filter by environment, project, or tags.
              </Text>
            </Box>
            <DocLink docSection="eventWebhooks">
              Setup instructions <PiArrowRight />
            </DocLink>
          </Flex>
        </Frame>
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
      isLoaded={!!data}
      onAdd={handleAdd}
      errorMessage={error?.message || null}
      createError={null}
    />
  );
};
