import React, { FC, useCallback, useState } from "react";
import z from "zod";
import { useForm } from "react-hook-form";
import { NotificationEventName } from "back-end/src/events/base-types";
import Modal from "@/components/Modal";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import CodeTextArea from "@/components/Forms/CodeTextArea";
import Toggle from "@/components/Forms/Toggle";
import {
  eventWebHookMethods,
  EventWebHookMethod,
  eventWebHookPayloadTypes,
  EventWebHookPayloadType,
  EventWebHookEditParams,
  eventWebHookEventOptions,
  EventWebHookModalMode,
  notificationEventNames,
} from "@/components/EventWebHooks/utils";
import { useEnvironments } from "@/services/features";
import { useDefinitions } from "@/services/DefinitionsContext";
import TagsInput from "@/components/Tags/TagsInput";

type EventWebHookAddEditModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: EventWebHookEditParams) => void;
  mode: EventWebHookModalMode;
  error: string | null;
};

const eventWebHookPayloadTypes = ["raw", "slack", "discord"] as const;

const forcePostMethodPayloadTypes: EventWebHookPayloadType[] = [
  "slack",
  "discord",
] as const;

const eventWebHookPayloadValues: { [k in EventWebHookPayloadType]: string } = {
  raw: "Raw",
  slack: "Slack",
  discord: "Discord",
  "ms-teams": "Microsoft Teams",
} as const;

export const EventWebHookAddEditModal: FC<EventWebHookAddEditModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  mode,
  error,
}) => {
  const [ctaEnabled, setCtaEnabled] = useState(false);
  const [validHeaders, setValidHeaders] = useState(true);
  const environmentSettings = useEnvironments();
  const environments = environmentSettings.map((env) => env.id);

  const validateHeaders = (headers: string) => {
    try {
      JSON.parse(headers);
      setValidHeaders(true);
      return true;
    } catch (error) {
      setValidHeaders(false);
      return false;
    }
  };

  const { projects, tags } = useDefinitions();

  const form = useForm<EventWebHookEditParams>({
    defaultValues:
      mode.mode === "edit"
        ? mode.data
        : {
            name: "",
            events: [],
            url: "",
            enabled: true,
            environments: [],
            projects: [],
            tags: [],
            payloadType: "raw",
            method: "POST",
            headers: "{}",
          },
  });

  const handleSubmit = form.handleSubmit(async (values) => {
    onSubmit({ ...values, headers: JSON.parse(values.headers) });
  });

  const modalTitle =
    mode.mode == "edit" ? "Edit Webhook" : "Create New Webhook";
  const buttonText = mode.mode == "edit" ? "Save" : "Create";

  const handleFormValidation = useCallback(() => {
    const formValues = form.getValues();
    if (!validateHeaders(formValues.headers)) return setCtaEnabled(false);

    const schema = z.object({
      url: z.string().url(),
      name: z.string().trim().min(2),
      enabled: z.boolean(),
      events: z.array(z.enum(notificationEventNames)).min(1),
      payloadType: z.enum(eventWebHookPayloadTypes),
      tags: z.array(z.string()),
      projects: z.array(z.string()),
      environments: z.array(z.string()),
      method: z.enum(eventWebHookMethods),
      headers: z.string(),
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
      <Field
        label="Webhook Name"
        placeholder="My Webhook"
        {...form.register("name")}
        onChange={(evt) => {
          form.setValue("name", evt.target.value);
          handleFormValidation();
        }}
      />

      <Field
        label="Endpoint URL"
        placeholder="https://example.com/growthbook-webhook"
        {...form.register("url")}
        helpText={
          <>
            Must accept <code>{form.watch("method")}</code> requests
          </>
        }
        onChange={(evt) => {
          form.setValue("url", evt.target.value);
          handleFormValidation();
        }}
      />

      <SelectField
        label="Method"
        value={form.watch("method")}
        placeholder="Choose HTTP method"
        disabled={forcePostMethodPayloadTypes.includes(
          form.watch("payloadType")
        )}
        options={eventWebHookMethods.map((method) => ({
          label: method,
          value: method,
        }))}
        onChange={(value: EventWebHookMethod) => {
          form.setValue("method", value);
          handleFormValidation();
        }}
      />

      <CodeTextArea
        label="Headers"
        language="json"
        minLines={1}
        value={form.watch("headers")}
        setValue={(headers) => {
          form.setValue("headers", headers);
          handleFormValidation();
        }}
        helpText={
          <>
            {!validHeaders ? (
              <div className="alert alert-danger mr-auto">Invalid JSON</div>
            ) : (
              <div>JSON format for headers.</div>
            )}
          </>
        }
      />

      <MultiSelectField
        label="Events"
        value={form.watch("events")}
        placeholder="Choose events"
        sort={false}
        options={eventWebHookEventOptions.map(({ id }) => ({
          label: id,
          value: id,
        }))}
        onChange={(value: string[]) => {
          form.setValue("events", value as NotificationEventName[]);
          handleFormValidation();
        }}
      />

      <SelectField
        label="Payload Type"
        value={form.watch("payloadType")}
        placeholder="Choose payload type"
        options={eventWebHookPayloadTypes.map((key) => ({
          label: eventWebHookPayloadValues[key],
          value: key,
        }))}
        onChange={(value: EventWebHookPayloadType) => {
          form.setValue("payloadType", value);
          if (forcePostMethodPayloadTypes.includes(value))
            form.setValue("method", "POST");
          handleFormValidation();
        }}
      />

      <MultiSelectField
        label="Environment filters"
        helpText="Only receive notifications for matching environments."
        sort={false}
        value={form.watch("environments")}
        options={environments.map((env) => ({
          label: env,
          value: env,
        }))}
        onChange={(value: string[]) => {
          form.setValue("environments", value);
          handleFormValidation();
        }}
      />

      <MultiSelectField
        label="Project filters"
        helpText="Only receive notifications for matching projects."
        sort={false}
        value={form.watch("projects")}
        options={projects.map(({ name, id }) => ({
          label: name,
          value: id,
        }))}
        onChange={(value: string[]) => {
          form.setValue("projects", value);
          handleFormValidation();
        }}
      />

      <div className="form-group">
        <label className="d-block">Tag filters</label>
        <div className="mt-1">
          <TagsInput
            tagOptions={tags}
            value={form.watch("tags")}
            onChange={(selected: string[]) => {
              form.setValue(
                "tags",
                selected.map((item) => item)
              );
              handleFormValidation();
            }}
          />
          <small className="text-muted">
            Only receive notifications for matching tags.
          </small>
        </div>
      </div>

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
