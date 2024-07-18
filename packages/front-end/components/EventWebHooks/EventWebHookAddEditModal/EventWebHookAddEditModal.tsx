import React, { FC, useCallback, useState } from "react";
import z from "zod";
import { useForm, UseFormReturn } from "react-hook-form";
import { NotificationEventName } from "back-end/src/events/base-types";
import clsx from "clsx";
import Modal from "@/components/Modal";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import CodeTextArea from "@/components/Forms/CodeTextArea";
import {
  eventWebHookMethods,
  EventWebHookMethod,
  EventWebHookPayloadType,
  EventWebHookEditParams,
  eventWebHookEventOptions,
  EventWebHookModalMode,
  notificationEventNames,
  webhookIcon,
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

const forcedParamsMap: {
  [key in EventWebHookPayloadType]?: {
    method: EventWebHookMethod;
    headers: string;
  };
} = {
  slack: { method: "POST", headers: "{}" },
  discord: { method: "POST", headers: "{}" },
};

const eventWebHookPayloadValues: { [k in EventWebHookPayloadType]: string } = {
  raw: "Raw",
  slack: "Slack",
  discord: "Discord",
} as const;

type Form = UseFormReturn<EventWebHookEditParams>;

const EventWebHookAddEditSettings = ({
  form,
  handleFormValidation,
  validHeaders,
  forcedParams,
}: {
  form: Form;
  handleFormValidation: () => void;
  validHeaders: boolean;
  forcedParams?: {
    method: EventWebHookMethod;
    headers: string;
  };
}) => {
  const environmentSettings = useEnvironments();
  const environments = environmentSettings.map((env) => env.id);

  const selectedPayloadType = form.watch("payloadType");
  const selectedEnvironments = form.watch("environments");
  const selectedProjects = form.watch("projects");
  const selectedTags = form.watch("tags");

  const { projects, tags } = useDefinitions();

  return (
    <>
      <SelectField
        label={<b>Payload Type</b>}
        value={form.watch("payloadType")}
        placeholder="Choose payload type"
        formatOptionLabel={({ label }) => (
          <span>
            <img
              src={webhookIcon[label]}
              className="mr-3"
              style={{ height: "2rem", width: "2rem" }}
            />
            {eventWebHookPayloadValues[label]}
          </span>
        )}
        options={eventWebHookPayloadTypes.map((key) => ({
          label: key,
          value: key,
        }))}
        onChange={(value: EventWebHookPayloadType) => {
          form.setValue("payloadType", value);
          handleFormValidation();
        }}
      />

      <div className="mt-4">
        <Field
          label={<b>Webhook Name</b>}
          placeholder="My Webhook"
          {...form.register("name")}
          onChange={(evt) => {
            form.setValue("name", evt.target.value);
            handleFormValidation();
          }}
        />
      </div>

      {selectedPayloadType === "raw" && (
        <div className="mt-4">
          <SelectField
            label={<b>Method</b>}
            value={forcedParams?.method || form.watch("method")}
            placeholder="Choose HTTP method"
            disabled={!!forcedParams}
            options={eventWebHookMethods.map((method) => ({
              label: method,
              value: method,
            }))}
            onChange={(value: EventWebHookMethod) => {
              form.setValue("method", value);
              handleFormValidation();
            }}
          />
        </div>
      )}

      <div className="mt-4">
        <Field
          label={<b>Endpoint URL</b>}
          placeholder="https://example.com/growthbook-webhook"
          {...form.register("url")}
          helpText={
            selectedPayloadType === "raw" && (
              <>
                Must accept <code>{form.watch("method")}</code> requests
              </>
            )
          }
          onChange={(evt) => {
            form.setValue("url", evt.target.value);
            handleFormValidation();
          }}
        />
      </div>

      {selectedPayloadType === "raw" && (
        <div className="mt-4">
          <CodeTextArea
            label={
              <>
                <b>Headers</b> (JSON)
              </>
            }
            language="json"
            minLines={forcedParams ? 1 : 3}
            maxLines={6}
            value={forcedParams?.headers || form.watch("headers")}
            disabled={!!forcedParams}
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
        </div>
      )}

      <div className="mt-4">
        <MultiSelectField
          label={<b>Events</b>}
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
      </div>

      <div className="mt-4 webhook-filters">
        <b>Apply Filters</b>

        <div className="graybox mt-2 border border-rounded">
          <div
            className={clsx({
              "select-all": !selectedEnvironments.length,
            })}
          >
            <MultiSelectField
              label={
                <div className="d-flex align-items-center">
                  <div>
                    <b>Environment</b>
                  </div>
                  <div className="ml-auto d-flex align-items-center">
                    <input
                      type="checkbox"
                      className="mr-1"
                      disabled={!selectedEnvironments.length}
                      checked={!selectedEnvironments.length}
                      onChange={() =>
                        selectedEnvironments.length
                          ? form.setValue("environments", [])
                          : undefined
                      }
                    />
                    Receive notifications for{" "}
                    <b className="ml-1">all Environments</b>
                  </div>
                </div>
              }
              labelClassName="w-100"
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
          </div>

          <div
            className={clsx({
              "select-all": !selectedProjects.length,
            })}
          >
            <MultiSelectField
              label={
                <div className="d-flex align-items-center">
                  <div>
                    <b>Projects</b>
                  </div>
                  <div className="ml-auto d-flex align-items-center">
                    <input
                      type="checkbox"
                      className="mr-1"
                      disabled={!selectedProjects.length}
                      checked={!selectedProjects.length}
                      onChange={() =>
                        selectedProjects.length
                          ? form.setValue("projects", [])
                          : undefined
                      }
                    />
                    Receive notifications for{" "}
                    <b className="ml-1">all Projects</b>
                  </div>
                </div>
              }
              labelClassName="w-100"
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
          </div>

          <div
            className={clsx("form-group", {
              "select-all": !selectedTags.length,
            })}
          >
            <label className="d-block w-100">
              <div className="d-flex align-items-center">
                <div>
                  <b>Tags</b>
                </div>
                <div className="ml-auto d-flex align-items-center">
                  <input
                    type="checkbox"
                    className="mr-1"
                    disabled={!selectedTags.length}
                    checked={!selectedTags.length}
                    onChange={() =>
                      selectedTags.length
                        ? form.setValue("tags", [])
                        : undefined
                    }
                  />
                  Receive notifications for <b className="ml-1">all Tags</b>
                </div>
              </div>
            </label>
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
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export const EventWebHookAddEditModal: FC<EventWebHookAddEditModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  mode,
  error,
}) => {
  const [ctaEnabled, setCtaEnabled] = useState(false);
  const [validHeaders, setValidHeaders] = useState(true);

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

  const forcedParams = forcedParamsMap[form.watch("payloadType")];

  const filteredValues = useCallback(
    (values) => ({ ...values, ...forcedParams }),
    [forcedParams]
  );

  const handleSubmit = form.handleSubmit(async (rawValues) => {
    const values = filteredValues(rawValues);
    onSubmit({ ...values, headers: JSON.parse(values.headers) });
  });

  const modalTitle =
    mode.mode == "edit" ? "Edit Webhook" : "Create New Webhook";
  const buttonText = mode.mode == "edit" ? "Save" : "Create";

  const handleFormValidation = useCallback(() => {
    const formValues = filteredValues(form.getValues());
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
  }, [filteredValues, form]);

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
      bodyClassName="mt-2"
      size="lg"
    >
      <EventWebHookAddEditSettings
        form={form}
        handleFormValidation={handleFormValidation}
        validHeaders={validHeaders}
        forcedParams={forcedParams}
      />
    </Modal>
  );
};
