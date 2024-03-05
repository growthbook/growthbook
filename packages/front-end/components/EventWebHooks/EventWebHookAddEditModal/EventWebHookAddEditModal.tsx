import React, { FC, useCallback, useState } from "react";
import z from "zod";
import { useForm } from "react-hook-form";
import { NotificationEventName } from "back-end/src/events/base-types";
import Modal from "@/components/Modal";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Toggle from "@/components/Forms/Toggle";
import {
  EventWebHookEditParams,
  eventWebHookEventOptions,
  EventWebHookModalMode,
  notificationEventNames,
} from "@/components/EventWebHooks/utils";

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
            enabled: true,
          },
  });

  const handleSubmit = form.handleSubmit(async (values) => {
    onSubmit(values);
  });

  const modalTitle =
    mode.mode == "edit" ? "Edit Webhook" : "Create New Webhook";
  const buttonText = mode.mode == "edit" ? "Save" : "Create";

  const handleFormValidation = useCallback(() => {
    const formValues = form.getValues();

    const schema = z.object({
      url: z.string().url(),
      name: z.string().trim().min(2),
      enabled: z.boolean(),
      events: z.array(z.enum(notificationEventNames)).min(1),
    });

    setCtaEnabled(schema.safeParse(formValues).success);
  }, [form]);

  if (!isOpen) return null;

  return (
    <Modal
      header={modalTitle}
      cta={buttonText}
      close={onClose}
      open={isOpen}
      submit={handleSubmit}
      error={error ?? undefined}
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

      <MultiSelectField
        label="Events"
        value={form.watch("events")}
        placeholder="Choose events"
        options={eventWebHookEventOptions.map(({ id }) => ({
          label: id,
          value: id,
        }))}
        onChange={(value: string[]) => {
          form.setValue("events", value as NotificationEventName[]);
          handleFormValidation();
        }}
      />

      <div className="form-group">
        <Toggle
          id="EventWebHookAddModal-enabled"
          value={form.watch("enabled")}
          setValue={(value) => {
            form.setValue("enabled", value);
            handleFormValidation();
          }}
        />
        <label htmlFor="EventWebHookAddModal-enabled">
          Enable the webhook?
        </label>
      </div>
    </Modal>
  );
};
