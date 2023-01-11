/* eslint-disable @typescript-eslint/ban-ts-comment */

import { EventWebHookInterface } from "back-end/types/event-webhook";
import { NotificationEventName } from "back-end/src/events/base-types";
import { action } from "@storybook/addon-actions";
import { getValidDate } from "../../../services/dates";
import { EventWebHookDetail } from "./EventWebHookDetail";

export default {
  component: EventWebHookDetail,
  title: "Event WebHooks/EventWebHookDetail",
};

const eventWebHookSuccessState: EventWebHookInterface = {
  events: ["feature.updated", "feature.created", "feature.deleted"],
  id: "ewh-4af2033e-80e7-45af-a06d-01f3fccc8d1e",
  organizationId: "org_sktwi1id9l7z9xkjb",
  name: "My 4th WebHook",
  dateCreated: new Date(),
  dateUpdated: new Date(),
  enabled: false,
  url: "http://192.168.0.15:1115/events/webhooks?v=4",
  signingKey: "ewhk_6220c5592f03244c43a929850816d644",
  lastRunAt: getValidDate(new Date().toString()),
  lastState: "success",
  lastResponseBody: null,
};

const eventWebHookFailedState: EventWebHookInterface = {
  events: ["feature.updated", "feature.created", "feature.deleted"],
  id: "ewh-4af2033e-80e7-45af-a06d-01f3fccc8d1e",
  organizationId: "org_sktwi1id9l7z9xkjb",
  name: "My 4th WebHook",
  dateCreated: new Date(),
  dateUpdated: new Date(),
  enabled: false,
  url: "http://192.168.0.15:1115/events/webhooks?v=4",
  signingKey: "ewhk_6220c5592f03244c43a929850816d644",
  lastRunAt: getValidDate(new Date().toString()),
  lastState: "error",
  lastResponseBody: null,
};

const eventWebHookNoState: EventWebHookInterface = {
  events: ["feature.updated", "feature.created", "feature.deleted"],
  id: "ewh-4af2033e-80e7-45af-a06d-01f3fccc8d1e",
  organizationId: "org_sktwi1id9l7z9xkjb",
  name: "My Brand New WebHook",
  dateCreated: new Date(),
  dateUpdated: new Date(),
  enabled: false,
  url: "http://192.168.0.15:1115/events/webhooks?v=4",
  signingKey: "ewhk_6220c5592f03244c43a929850816d644",
  lastRunAt: null,
  lastState: "none",
  lastResponseBody: null,
};

export const SuccessfulRun = () => {
  return (
    <EventWebHookDetail
      editError={null}
      onEditModalOpen={action("onEditModalOpen")}
      onModalClose={action("onModalClose")}
      isModalOpen={false}
      onDelete={async () => {
        action("onDelete")();
      }}
      onEdit={async () => {
        action("onEdit")();
      }}
      eventWebHook={eventWebHookSuccessState}
    />
  );
};

export const FailedRun = () => {
  return (
    <EventWebHookDetail
      editError={null}
      onEditModalOpen={action("onEditModalOpen")}
      onModalClose={action("onModalClose")}
      isModalOpen={false}
      onDelete={async () => {
        action("onDelete")();
      }}
      onEdit={async () => {
        action("onEdit")();
      }}
      eventWebHook={eventWebHookFailedState}
    />
  );
};

export const WithoutRuns = () => {
  return (
    <EventWebHookDetail
      editError={null}
      onEditModalOpen={action("onEditModalOpen")}
      onModalClose={action("onModalClose")}
      isModalOpen={false}
      onDelete={async () => {
        action("onDelete")();
      }}
      onEdit={async () => {
        action("onEdit")();
      }}
      eventWebHook={eventWebHookNoState}
    />
  );
};

export const LotsOfEvents = () => {
  // These are fake event names, for now, until we create them.
  const eventsList: NotificationEventName[] = [
    "feature.created",
    "feature.updated",
    "feature.deleted",
    // @ts-ignore
    "experiment.created",
    // @ts-ignore
    "experiment.updated",
    // @ts-ignore
    "experiment.deleted",
    // @ts-ignore
    "another_resource.created",
    // @ts-ignore
    "another_resource.updated",
    // @ts-ignore
    "another_resource.deleted",
  ];

  return (
    <EventWebHookDetail
      editError={null}
      onEditModalOpen={action("onEditModalOpen")}
      onModalClose={action("onModalClose")}
      isModalOpen={false}
      onDelete={async () => {
        action("onDelete")();
      }}
      onEdit={async () => {
        action("onEdit")();
      }}
      eventWebHook={{
        ...eventWebHookSuccessState,
        events: eventsList,
      }}
    />
  );
};
