import React, { FC, useCallback, useState } from "react";
import { useForm } from "react-hook-form";
import z from "zod";
import { NotificationEventName } from "back-end/src/events/base-types";
import { TagInterface } from "back-end/types/tag";
import {
  eventWebHookEventOptions,
  notificationEventNames,
} from "@/components/EventWebHooks/utils";
import {
  SlackIntegrationEditParams,
  SlackIntegrationModalMode,
} from "@/components/SlackIntegrations/slack-integrations-utils";
import Modal from "@/components/Modal";
import TagsInput from "@/components/Tags/TagsInput";
import Field from "@/components/Forms/Field";
import MultiSelectField from "@/components/Forms/MultiSelectField";

type SlackIntegrationAddEditModalProps = {
  projects: {
    id: string;
    name: string;
  }[];
  environments: string[];
  tagOptions: TagInterface[];
  isOpen: boolean;
  onClose: () => void;
  onCreate: (data: SlackIntegrationEditParams) => void;
  onUpdate: (id: string, data: SlackIntegrationEditParams) => void;
  mode: SlackIntegrationModalMode;
  error: string | null;
};

export const SlackIntegrationAddEditModal: FC<SlackIntegrationAddEditModalProps> = ({
  projects,
  environments,
  tagOptions,
  isOpen,
  mode,
  error,
  onClose,
  onCreate,
  onUpdate,
}) => {
  const [ctaEnabled, setCtaEnabled] = useState(false);

  const form = useForm<SlackIntegrationEditParams>({
    defaultValues:
      mode.mode === "edit"
        ? mode.data
        : {
            name: "",
            events: [],
            description: "",
            slackAppId: "",
            environments: [],
            projects: [],
            slackSigningKey: "",
            slackIncomingWebHook: "",
            tags: [],
          },
  });

  const handleSubmit = form.handleSubmit(async (values) => {
    if (mode.mode === "edit") {
      onUpdate(mode.id, values);
    } else {
      onCreate(values);
    }
  });

  const modalTitle =
    mode.mode == "edit"
      ? "Edit Slack integration"
      : "Create a new Slack integration";
  const buttonText = mode.mode == "edit" ? "Save" : "Create";

  const handleFormValidation = useCallback(() => {
    const formValues = form.getValues();

    const schema = z.object({
      name: z.string().trim().min(2),
      description: z.string().trim().min(0),
      projects: z.array(z.string()),
      environments: z.array(z.string()),
      events: z.array(z.enum(notificationEventNames)),
      tags: z.array(z.string()),
      slackAppId: z.string().trim().min(2),
      slackSigningKey: z.string().trim().min(2),
      slackIncomingWebHook: z
        .string()
        .url()
        .startsWith("https://hooks.slack.com/services/"),
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
      autoCloseOnSubmit={false}
      submit={handleSubmit}
      error={error}
      ctaEnabled={ctaEnabled}
    >
      <p>
        Create an app in Slack and add the information here. For help, please{" "}
        <a
          target="_blank"
          rel="noreferrer noopener"
          href="https://docs.growthbook.io/integrations/slack"
        >
          see the documentation
        </a>
        .
      </p>
      <Field
        label="Name"
        placeholder="My Slack integration"
        autoComplete="off"
        required
        {...form.register("name")}
        onChange={(evt) => {
          form.setValue("name", evt.target.value);
          handleFormValidation();
        }}
      />

      <Field
        label="Description"
        placeholder="(optional description)"
        autoComplete="off"
        {...form.register("description")}
        onChange={(evt) => {
          form.setValue("description", evt.target.value);
          handleFormValidation();
        }}
      />

      <MultiSelectField
        label="Event filters"
        helpText="Only receive notifications for matching events."
        value={form.watch("events")}
        options={eventWebHookEventOptions.map(({ id }) => ({
          label: id,
          value: id,
        }))}
        onChange={(value: string[]) => {
          form.setValue("events", value as NotificationEventName[]);
          handleFormValidation();
        }}
      />

      <Field
        label="Slack App ID"
        autoComplete="off"
        helpText="Copy the Slack App ID from the app's Basic Information page"
        required
        {...form.register("slackAppId")}
        onChange={(evt) => {
          form.setValue("slackAppId", evt.target.value);
          handleFormValidation();
        }}
      />

      <Field
        label="Slack App Incoming Webhook URL"
        autoComplete="off"
        helpText="Copy the Incoming Webhook URL for your Slack App. This can be found on the Incoming Webhooks page under Features for your Slack app configuration"
        required
        {...form.register("slackIncomingWebHook")}
        onChange={(evt) => {
          form.setValue("slackIncomingWebHook", evt.target.value);
          handleFormValidation();
        }}
      />

      <Field
        label="Slack Signing Key"
        autoComplete="off"
        required
        helpText="Copy the signing key from the app's Basic Information page"
        {...form.register("slackSigningKey")}
        onChange={(evt) => {
          form.setValue("slackSigningKey", evt.target.value);
          handleFormValidation();
        }}
      />

      <MultiSelectField
        label="Environment filters"
        helpText="Only receive notifications for matching environments."
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
            tagOptions={tagOptions}
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
    </Modal>
  );
};
