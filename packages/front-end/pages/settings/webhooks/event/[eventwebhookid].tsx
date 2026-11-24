import React from "react";
import { NextPage } from "next";
import { useRouter } from "next/router";
import { EventWebHookInterface } from "shared/types/event-webhook";
import useApi from "@/hooks/useApi";
import SettingsPage from "@/components/Layout/SettingsPage";
import Callout from "@/ui/Callout";
import LoadingSpinner from "@/components/LoadingSpinner";
import EventWebHookPage from "@/components/EventWebHooks/EventWebHookPage";

const EventWebHookDetailPage: NextPage = () => {
  const router = useRouter();
  const { eventwebhookid: eventWebHookId } = router.query;
  const isNew = eventWebHookId === "new";

  const { data, mutate, error } = useApi<{
    eventWebHook: EventWebHookInterface;
  }>(`/event-webhooks/${eventWebHookId}`, {
    shouldRun: () => !!eventWebHookId && !isNew,
  });

  if (isNew) {
    return <EventWebHookPage eventWebHook={null} mutate={mutate} />;
  }
  if (error) {
    return (
      <SettingsPage
        title="Webhook"
        parent={{ display: "Webhooks", href: "/settings/webhooks" }}
      >
        <Callout status="error">This webhook could not be loaded.</Callout>
      </SettingsPage>
    );
  }
  if (!data) {
    return (
      <SettingsPage
        title="Webhook"
        hideHeader
        parent={{ display: "Webhooks", href: "/settings/webhooks" }}
      >
        <LoadingSpinner />
      </SettingsPage>
    );
  }
  return <EventWebHookPage eventWebHook={data.eventWebHook} mutate={mutate} />;
};

export default EventWebHookDetailPage;
