import React from "react";
import { NextPage } from "next";
import { useRouter } from "next/router";
import { EventWebHookInterface } from "shared/types/event-webhook";
import { Box } from "@radix-ui/themes";
import { EventWebHookDetailContainer } from "@/components/EventWebHooks/EventWebHookDetail/EventWebHookDetail";
import { EventWebHookLogsContainer } from "@/components/EventWebHooks/EventWebHookLogs/EventWebHookLogs";
import useApi from "@/hooks/useApi";
import SettingsPage from "@/components/Layout/SettingsPage";
import Callout from "@/ui/Callout";
import LoadingOverlay from "@/components/LoadingOverlay";

const EventWebHookDetailPage: NextPage = () => {
  const router = useRouter();
  const { eventwebhookid: eventWebHookId } = router.query;

  const {
    data,
    mutate: mutateEventWebHook,
    error,
  } = useApi<{
    eventWebHook: EventWebHookInterface;
  }>(`/event-webhooks/${eventWebHookId}`);

  const eventWebHook = data?.eventWebHook;
  const title = eventWebHook?.name ?? "Webhook";

  return (
    <SettingsPage
      title={title}
      // The webhook renders its own header; the page title only covers errors.
      hideHeader={!error}
      breadcrumb={[
        { display: "Settings" },
        { display: "Organization" },
        { display: "Webhooks", href: "/settings/webhooks" },
        { display: title },
      ]}
    >
      {error ? (
        <Callout status="error">
          Unable to fetch event web hook {eventWebHookId}
        </Callout>
      ) : eventWebHook ? (
        <>
          <EventWebHookDetailContainer
            eventWebHook={eventWebHook}
            mutateEventWebHook={mutateEventWebHook}
          />
          <Box mt="4">
            <EventWebHookLogsContainer />
          </Box>
        </>
      ) : (
        <LoadingOverlay />
      )}
    </SettingsPage>
  );
};

export default EventWebHookDetailPage;
