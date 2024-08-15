import React from "react";
import { NextPage } from "next";
import { useRouter } from "next/router";
import { EventWebHookInterface } from "back-end/types/event-webhook";
import { EventWebHookDetailContainer } from "@front-end/components/EventWebHooks/EventWebHookDetail/EventWebHookDetail";
import { EventWebHookLogsContainer } from "@front-end/components/EventWebHooks/EventWebHookLogs/EventWebHookLogs";
import useApi from "@front-end/hooks/useApi";
import PageHead from "@front-end/components/Layout/PageHead";

const EventWebHookDetailPage: NextPage = () => {
  const router = useRouter();
  const { eventwebhookid: eventWebHookId } = router.query;

  const { data, mutate: mutateEventWebHook, error } = useApi<{
    eventWebHook: EventWebHookInterface;
  }>(`/event-webhooks/${eventWebHookId}`);

  if (error)
    return (
      <div className="alert alert-danger">
        Unable to fetch event web hook {eventWebHookId}
      </div>
    );

  if (!data) return null;

  const { eventWebHook } = data;

  return (
    <>
      <PageHead
        breadcrumb={[
          {
            display: "Webhooks",
            href: `/settings/webhooks`,
          },
          { display: eventWebHook.name },
        ]}
      />
      <div className="container pagecontents">
        <EventWebHookDetailContainer
          eventWebHook={eventWebHook}
          mutateEventWebHook={mutateEventWebHook}
        />

        <div className="mt-4">
          <EventWebHookLogsContainer />
        </div>
      </div>
    </>
  );
};

export default EventWebHookDetailPage;
