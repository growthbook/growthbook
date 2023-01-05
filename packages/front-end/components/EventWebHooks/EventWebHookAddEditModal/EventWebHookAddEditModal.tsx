import React, { FC, useCallback, useState } from "react";
import z from "zod";
import { useForm } from "react-hook-form";
import { Typeahead } from "react-bootstrap-typeahead";
import { NotificationEventName } from "back-end/src/events/base-types";
import Modal from "@/components/Modal";
import {
  EventWebHookEditParams,
  eventWebHookEventOptions,
  EventWebHookModalMode,
  notificationEventNames,
} from "../utils";

type EventWebHookAddEditModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: EventWebHookEditParams) => void;
  mode: EventWebHookModalMode;
  error: string | null;
};

export const EventWebHookAddEditModal: FC<EventWebHookAddEditModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  mode,
  error,
}) => {
  const [ctaEnabled, setCtaEnabled] = useState(false);

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

  const handleFormValidation = useCallback(() => {
    const formValues = form.getValues();

    const schema = z.object({
      url: z.string().url(),
      name: z.string().trim().min(2),
      events: z.array(z.enum(notificationEventNames)).min(1),
    });

    setCtaEnabled(schema.safeParse(formValues).success);
  }, [form]);

  if (!isOpen) return null;

  return (
    <Modal
      header={modalTitle}
      cta="Create"
      close={onClose}
      open={isOpen}
      submit={handleSubmit}
      error={error}
      ctaEnabled={ctaEnabled}
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
          onChange={(evt) => {
            form.setValue("name", evt.target.value);
            handleFormValidation();
          }}
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
          onChange={(evt) => {
            form.setValue("url", evt.target.value);
            handleFormValidation();
          }}
        />
      </div>

      <div className="form-group">
        <label className="d-block">Events</label>
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
              handleFormValidation();
            }}
            selected={form.watch("events").map((v) => ({ id: v, name: v }))}
            placeholder="Choose events"
            positionFixed={true}
          />
        </div>
      </div>
    </Modal>
  );
};
