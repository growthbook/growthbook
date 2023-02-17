import { action } from "@storybook/addon-actions";
import { EventWebHookAddEditModal } from "./EventWebHookAddEditModal";

export default {
  component: EventWebHookAddEditModal,
  title: "Event WebHooks/EventWebHookAddEditModal",
};

export const AddMode = () => {
  return (
    <EventWebHookAddEditModal
      error={null}
      isOpen={true}
      onClose={action("perform close")}
      onSubmit={action("Submitted data")}
      mode={{ mode: "create" }}
    />
  );
};

export const EditMode = () => {
  return (
    <EventWebHookAddEditModal
      error={null}
      isOpen={true}
      onClose={action("perform close")}
      onSubmit={action("Submitted data")}
      mode={{
        mode: "edit",
        data: {
          events: ["feature.updated", "feature.deleted"],
          url: "http://192.168.0.15:1115/events/webhooks?v=1",
          name: "Main REST API",
        },
      }}
    />
  );
};
