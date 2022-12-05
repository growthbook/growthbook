import React, { FC } from "react";
import Modal from "../../Modal";
import { NotificationEventName } from "back-end/src/events/base-types";
import { EventWebHookCreateParams, eventWebHookEventOptions } from "../utils";
import { useForm } from "react-hook-form";
import { Typeahead } from "react-bootstrap-typeahead";

type EventWebHookAddModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: EventWebHookCreateParams) => void;
};

export const EventWebHookAddModal: FC<EventWebHookAddModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
}) => {
  const form = useForm<EventWebHookCreateParams>({
    defaultValues: {
      name: "",
      events: [],
      url: "",
    },
  });

  const handleSubmit = form.handleSubmit(async (values) => {
    onSubmit(values);
  });

  return (
    <Modal
      header="Create New Webhook"
      cta="Create"
      close={onClose}
      open={isOpen}
      submit={handleSubmit}
    >
      <div className="form-group">
        <label htmlFor="EventWebHookAddModal-name">Webhook Name</label>

        <input
          {...form.register("name")}
          className="form-control"
          type="text"
          autoComplete="off"
          placeholder="My Webhook"
          name="webhook_name"
          id="EventWebHookAddModal-name"
        />
      </div>

      <div className="form-group">
        <label htmlFor="EventWebHookAddModal-url">Endpoint URL</label>

        <input
          {...form.register("url")}
          className="form-control"
          type="text"
          autoComplete="off"
          name="webhook_url"
          placeholder="https://example.com/growthbook-webhook"
          id="EventWebHookAddModal-url"
        />
      </div>

      <div className="form-group">
        <label className="d-block">
          <span>Events</span>
          <div className="mt-1">
            <Typeahead
              id="events-input"
              labelKey="name"
              multiple={true}
              allowNew={true}
              options={eventWebHookEventOptions.map(({ id }) => {
                return {
                  id: id,
                  name: id,
                };
              })}
              onChange={(
                selected: {
                  id: NotificationEventName;
                  name: NotificationEventName;
                }[]
              ) => {
                form.setValue(
                  "events",
                  selected.map((item) => item.id)
                );
              }}
              selected={form.watch("events").map((v) => ({ id: v, name: v }))}
              placeholder="Choose events"
              positionFixed={true}
            />
          </div>
        </label>
      </div>
    </Modal>
  );
};
