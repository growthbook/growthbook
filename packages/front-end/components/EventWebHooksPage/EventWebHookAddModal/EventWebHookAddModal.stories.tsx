import { action } from "@storybook/addon-actions";
import { EventWebHookAddModal } from "./EventWebHookAddModal";

export default {
  component: EventWebHookAddModal,
  title: "Event WebHooks/EventWebHookAddModal",
};

export const Default = () => {
  return (
    <EventWebHookAddModal
      isOpen={true}
      onClose={action("perform close")}
      onSubmit={action("Submitted data")}
    />
  );
};
