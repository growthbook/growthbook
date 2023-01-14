import React, { FC, useCallback, useState } from "react";
import { useForm } from "react-hook-form";
import { Typeahead } from "react-bootstrap-typeahead";
import z from "zod";
import {
  eventWebHookEventOptions,
  notificationEventNames,
} from "@/components/EventWebHooks/utils";
import {
  SlackIntegrationEditParams,
  SlackIntegrationModalMode,
} from "@/components/SlackIntegrations/slack-integrations-utils";
import Modal from "@/components/Modal";
import { NotificationEventName } from "back-end/src/events/base-types";
import TagsInput from "@/components/Tags/TagsInput";
import { TagInterface } from "back-end/types/tag";
import Field from "@/components/Forms/Field";

type SlackIntegrationAddEditModalProps = {
  projects: {
    id: string;
    name: string;
  }[];
  environments: string[];
  tagOptions: TagInterface[];
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: SlackIntegrationEditParams) => void;
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
  onSubmit,
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
            project: "",
            slackSigningKey: "",
            tags: [],
          },
  });

  const handleSubmit = form.handleSubmit(async (values) => {
    onSubmit(values);
  });

  const modalTitle =
    mode.mode == "edit"
      ? "Edit Slack integration"
      : "Create a new Slack integration";
  const buttonText = mode.mode == "edit" ? "Save" : "Create";

  const handleFormValidation = useCallback(() => {
    const formValues = form.getValues();

    console.log(">>> form values", formValues);

    const schema = z.object({
      name: z.string().trim().min(2),
      description: z.string().trim().min(0),
      project: z.string().trim().min(0),
      environments: z.array(z.string()),
      events: z.array(z.enum(notificationEventNames)),
      tags: z.array(z.string()),
      slackAppId: z.string().trim().min(2),
      slackSigningKey: z.string().trim().min(2),
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
      error={error}
      ctaEnabled={ctaEnabled}
    >
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

      <div className="form-group">
        <label className="d-block">Event filters</label>
        <div className="mt-1">
          <Typeahead
            id="events-input"
            labelKey="name"
            multiple={true}
            allowNew={false}
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
          <small className="text-muted">
            Only receive notifications for matching events.
          </small>
        </div>
      </div>

      <div className="form-group">
        <label className="d-block">Environment filters</label>
        <div className="mt-1">
          <Typeahead
            id="events-input"
            labelKey="name"
            multiple={true}
            allowNew={false}
            options={environments.map((env) => {
              return {
                id: env,
                name: env,
              };
            })}
            onChange={(selected: { id: string; name: string }[]) => {
              form.setValue(
                "environments",
                selected.map((v) => v.id)
              );
              handleFormValidation();
            }}
            selected={form
              .watch("environments")
              .map((v) => ({ id: v, name: v }))}
            placeholder="Choose environments"
            positionFixed={true}
          />
          <small className="text-muted">
            Only receive notifications for matching environments.
          </small>
        </div>
      </div>

      {/* TODO: Make projects plural */}
      {/*<div className="form-group">*/}
      {/*  <label className="d-block">Project filters</label>*/}
      {/*  <div className="mt-1">*/}
      {/*    <Typeahead*/}
      {/*      id="project-input"*/}
      {/*      labelKey="name"*/}
      {/*      multiple={false}*/}
      {/*      allowNew={false}*/}
      {/*      options={projects}*/}
      {/*      onChange={(selected: { id: string; name: string }[]) => {*/}
      {/*        form.setValue("project", selected.map((v) => v.id)[0] || "");*/}
      {/*        handleFormValidation();*/}
      {/*      }}*/}
      {/*      selected={form.watch("projects").map((v) => ({ id: v, name: v }))}*/}
      {/*      placeholder="Choose project"*/}
      {/*      positionFixed={true}*/}
      {/*    />*/}
      {/*    <small className="text-muted">*/}
      {/*      Only receive notifications for matching projects.*/}
      {/*    </small>*/}
      {/*  </div>*/}
      {/*</div>*/}

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
