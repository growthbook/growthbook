import React, { FC } from "react";
import { NotificationEventName } from "back-end/src/events/base-types";
import { useForm } from "react-hook-form";
import { Typeahead } from "react-bootstrap-typeahead";
import Modal from "@/components/Modal";
import {
  EventWebHookEditParams,
  eventWebHookEventOptions,
  EventWebHookModalMode,
} from "../utils";

type EventWebHookAddEditModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: EventWebHookEditParams) => void;
  mode: EventWebHookModalMode;
};

export const EventWebHookAddEditModal: FC<EventWebHookAddEditModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  mode,
}) => {
  const form = useForm<EventWebHookEditParams>({
    defaultValues:
      mode.mode === "edit"
        ? mode.data
        : {
            name: "",
            events: [],
            url: "",
          },
  });

  const handleSubmit = form.handleSubmit(async (values) => {
    onSubmit(values);
  });

  const modalTitle =
    mode.mode == "edit" ? "Edit Webhook" : "Create New Webhook";

  if (!isOpen) return null;

  return (
    <Modal
      header={modalTitle}
      cta="Create"
      close={onClose}
      open={isOpen}
      submit={handleSubmit}
    >
      <div className="form-group">
        <label htmlFor="EventWebHookAddModal-name">Webhook Name</label>

        <input
          className="form-control"
          type="text"
          autoComplete="off"
          placeholder="My Webhook"
          id="EventWebHookAddModal-name"
          {...form.register("name")}
        />
      </div>

      <div className="form-group">
        <label htmlFor="EventWebHookAddModal-url">Endpoint URL</label>

        <input
          className="form-control"
          type="text"
          autoComplete="off"
          placeholder="https://example.com/growthbook-webhook"
          id="EventWebHookAddModal-url"
          {...form.register("url")}
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
