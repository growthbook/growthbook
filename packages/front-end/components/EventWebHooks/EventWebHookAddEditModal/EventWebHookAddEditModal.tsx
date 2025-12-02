import React, { FC, useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { useForm, UseFormReturn } from "react-hook-form";
import { NotificationEventName } from "back-end/src/events/base-types";
import clsx from "clsx";
import { PiCheckCircleFill, PiXSquare } from "react-icons/pi";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import CodeTextArea from "@/components/Forms/CodeTextArea";
import {
  eventWebHookPayloadTypes,
  legacyEventWebHookPayloadTypes,
  eventWebHookMethods,
  EventWebHookMethod,
  EventWebHookPayloadType,
  EventWebHookEditParams,
  eventWebHookEventOptions,
  EventWebHookModalMode,
  notificationEventNames,
  WebhookIcon,
} from "@/components/EventWebHooks/utils";
import { useEnvironments } from "@/services/features";
import { useDefinitions } from "@/services/DefinitionsContext";
import TagsInput from "@/components/Tags/TagsInput";
import { DocLink } from "@/components/DocLink";

type EventWebHookAddEditModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: EventWebHookEditParams) => void;
  mode: EventWebHookModalMode;
  error: string | null;
};

const detailedWebhook = (s: string) => ["raw", "json"].includes(s);

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
  raw: "Raw (Legacy)",
  json: "JSON",
  slack: "Slack",
  discord: "Discord",
} as const;

type Form = UseFormReturn<EventWebHookEditParams>;

type ConfirmState =
  | { type: "idle" }
  | { type: "sent" }
  | { type: "success" }
  | { type: "error"; message: string };

const EventWebHookAddConfirm = ({ form }: { form: Form }) => {
  const [state, setState] = useState<ConfirmState>({ type: "idle" });
  const { apiCall } = useAuth();

  const onTestWebhook = useCallback(async () => {
    setState({ type: "sent" });

    try {
      const response = await apiCall<{
        error?: string;
      }>("/event-webhooks/test-params", {
        method: "POST",
        body: JSON.stringify({
          name: form.watch("name"),
          method: form.watch("method"),
          url: form.watch("url"),
        }),
      });

      if (response.error) {
        setState({
          type: "error",
          message: `Webhook test failed: ${response.error || "Unknown error"}`,
        });
        return;
      }

      setState({ type: "success" });
    } catch (e) {
      setState({ type: "error", message: "Unknown error" });
    }
  }, [setState, apiCall, form]);

  return (
    <div className="mx-2 mb-5">
      <p className="mb-0">
        We recommend testing your connection to ensure your settings are
        correct.
      </p>
      <p className="mt-0 text-danger">
        <b>Important:</b> Do not navigate away from this modal, or your changes
        will not be saved.
      </p>

      <button
        className="btn btn-outline-primary mr-2 mb-2"
        disabled={state.type === "sent"}
        onClick={onTestWebhook}
      >
        {state.type === "sent" ? (
          <>
            <span className="mr-2">
              <PiCheckCircleFill />
            </span>{" "}
            Test Sent
          </>
        ) : (
          "Test Connection"
        )}
      </button>

      <div className="mt-2 d-flex align-items-center">
        {state.type === "success" && (
          <p className="text-success">
            <PiCheckCircleFill /> Test Sucessful!
          </p>
        )}
        {state.type === "error" && (
          <p className="text-danger">
            <PiXSquare /> Test Failed: {state.message}
          </p>
        )}
        {state.type !== "error" && state.type !== "success" && (
          <p className="invisible">Placeholder for height</p>
        )}
      </div>
    </div>
  );
};

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

  const isDetailedWebhook = detailedWebhook(selectedPayloadType);

  const { projects, tags } = useDefinitions();

  return (
    <>
      <SelectField
        label={<b>Payload Type</b>}
        value={form.watch("payloadType")}
        placeholder="Choose payload type"
        disabled={form.watch("payloadType") === "raw"}
        formatOptionLabel={({ label }) => (
          <span>
            <WebhookIcon
              type={label as EventWebHookPayloadType}
              className="mr-3"
              style={{ height: "2rem", width: "2rem" }}
            />
            {eventWebHookPayloadValues[label]}
          </span>
        )}
        options={
          form.watch("payloadType") === "raw"
            ? [{ label: "raw", value: "raw" }]
            : eventWebHookPayloadTypes.map((key) => ({
                label: key,
                value: key,
              }))
        }
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

      {isDetailedWebhook && (
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
            isDetailedWebhook && (
              <>
                Must accept <code>{form.watch("method")}</code> requests.
                Supports{" "}
                <DocLink docSection="webhookSecrets">Webhook Secrets</DocLink>.
              </>
            )
          }
          onChange={(evt) => {
            form.setValue("url", evt.target.value);
            handleFormValidation();
          }}
        />
      </div>

      {isDetailedWebhook && (
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
                  <div>
                    JSON format for headers. Supports{" "}
                    <DocLink docSection="webhookSecrets">
                      Webhook Secrets
                    </DocLink>
                    .
                  </div>
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
          disabled={form.watch("payloadType") === "raw"}
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
                    selected.map((item) => item),
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

type Step = "create" | "confirm" | "edit";

const buttonText = ({
  step,
  payloadType,
}: {
  step: Step;
  payloadType: EventWebHookPayloadType;
}) => {
  let invalidStep: never;

  switch (step) {
    case "create":
      if (detailedWebhook(payloadType)) return "Create";
      return "Next >";

    case "confirm":
      return "Create";

    case "edit":
      return "Save";

    default:
      invalidStep = step;
      throw new Error(`Invalid step: ${invalidStep}`);
  }
};

export const EventWebHookAddEditModal: FC<EventWebHookAddEditModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  mode,
  error,
}) => {
  const [submitEnabled, setSubmitEnabled] = useState(false);
  const [validHeaders, setValidHeaders] = useState(true);
  const [step, setStep] = useState<Step>(mode.mode);

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
            payloadType: "json",
            method: "POST",
            headers: "{}",
          },
  });

  const forcedParams = forcedParamsMap[form.watch("payloadType")];

  const filteredValues = useCallback(
    (values) => ({ ...values, ...forcedParams }),
    [forcedParams],
  );

  const handleSubmit = useMemo(() => {
    if (step === "create" && !detailedWebhook(form.watch("payloadType")))
      return () => setStep("confirm");

    return form.handleSubmit(async (rawValues) => {
      const values = filteredValues(rawValues);
      onSubmit({ ...values, headers: JSON.parse(values.headers) });
    });
  }, [step, onSubmit, form, filteredValues]);

  const modalTitle =
    mode.mode === "edit" ? "Edit Webhook" : "Create New Webhook";

  const handleFormValidation = useCallback(() => {
    const formValues = filteredValues(form.getValues());
    if (!validateHeaders(formValues.headers)) return setSubmitEnabled(false);

    const schema = z.object({
      url: z.string().url(),
      name: z.string().trim().min(2),
      enabled: z.boolean(),
      events: z.array(z.enum(notificationEventNames)).min(1),
      payloadType: z.enum(
        mode.mode === "edit"
          ? legacyEventWebHookPayloadTypes
          : eventWebHookPayloadTypes,
      ),
      tags: z.array(z.string()),
      projects: z.array(z.string()),
      environments: z.array(z.string()),
      method: z.enum(eventWebHookMethods),
      headers: z.string(),
    });

    setSubmitEnabled(schema.safeParse(formValues).success);
  }, [filteredValues, form, mode.mode]);

  useEffect(handleFormValidation);

  if (!isOpen) return null;

  return (
    <Modal
      trackingEventModalType=""
      header={modalTitle}
      cta={buttonText({ step, payloadType: form.watch("payloadType") })}
      includeCloseCta={false}
      open={isOpen}
      error={error ?? undefined}
      bodyClassName="mt-2"
      size="lg"
      secondaryCTA={
        step === "confirm" ? (
          <button className="btn btn-link" onClick={() => setStep("create")}>
            {"< Back"}
          </button>
        ) : (
          <button className="btn btn-link" onClick={onClose}>
            Close
          </button>
        )
      }
      tertiaryCTA={
        <button
          disabled={!submitEnabled}
          onClick={handleSubmit}
          className="btn btn-primary"
        >
          {buttonText({ step, payloadType: form.watch("payloadType") })}
        </button>
      }
    >
      {step === "confirm" ? (
        <EventWebHookAddConfirm form={form} />
      ) : (
        <EventWebHookAddEditSettings
          form={form}
          handleFormValidation={handleFormValidation}
          validHeaders={validHeaders}
          forcedParams={forcedParams}
        />
      )}
    </Modal>
  );
};
