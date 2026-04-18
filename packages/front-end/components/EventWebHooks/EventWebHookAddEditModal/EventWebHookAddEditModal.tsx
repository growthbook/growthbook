import React, { FC, useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { useForm, UseFormReturn } from "react-hook-form";
import clsx from "clsx";
import { Box, Flex } from "@radix-ui/themes";
import { PiArrowLeft, PiCaretRight, PiCheckCircleFill } from "react-icons/pi";
import Text from "@/ui/Text";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import CodeTextArea from "@/components/Forms/CodeTextArea";
import Button from "@/ui/Button";
import Checkbox from "@/ui/Checkbox";
import Callout from "@/ui/Callout";
import {
  eventWebHookPayloadTypes,
  legacyEventWebHookPayloadTypes,
  eventWebHookMethods,
  EventWebHookMethod,
  EventWebHookPayloadType,
  EventWebHookEditParams,
  eventWebHookEventOptions,
  formatWebhookEventOptionLabel,
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
  onSubmit: (data: EventWebHookEditParams) => Promise<void>;
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
    <Box mx="2" mb="5">
      <Text as="p" mb="2">
        We recommend testing your connection to ensure your settings are
        correct.
      </Text>
      <Callout status="warning" mb="3">
        <strong>Important:</strong> Do not navigate away from this modal, or
        your changes will not be saved.
      </Callout>

      <Button
        variant="outline"
        disabled={state.type === "sent"}
        onClick={onTestWebhook}
        icon={state.type === "sent" ? <PiCheckCircleFill /> : undefined}
      >
        {state.type === "sent" ? "Test Sent" : "Test Connection"}
      </Button>

      <Box mt="2">
        {state.type === "success" && (
          <Callout status="success">Test Successful!</Callout>
        )}
        {state.type === "error" && (
          <Callout status="error">Test Failed: {state.message}</Callout>
        )}
      </Box>
    </Box>
  );
};

const FilterLabel = ({
  name,
  allLabel,
  isAll,
  disabled,
  onSelectAll,
}: {
  name: string;
  allLabel: string;
  isAll: boolean;
  disabled: boolean;
  onSelectAll: () => void;
}) => (
  <Flex align="center" justify="between" gap="4" style={{ width: "100%" }}>
    <Text>{name}</Text>
    <Checkbox
      value={isAll}
      disabled={disabled}
      setValue={onSelectAll}
      label={allLabel}
      weight="regular"
      size="sm"
    />
  </Flex>
);

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
        label="Payload Type"
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

      <Box mt="4">
        <Field
          label="Webhook Name"
          placeholder="My Webhook"
          {...form.register("name")}
          onChange={(evt) => {
            form.setValue("name", evt.target.value);
            handleFormValidation();
          }}
        />
      </Box>

      {isDetailedWebhook && (
        <Box mt="4">
          <SelectField
            label="Method"
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
        </Box>
      )}

      <Box mt="4">
        <Field
          label="Endpoint URL"
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
      </Box>

      {isDetailedWebhook && (
        <Box mt="4">
          <CodeTextArea
            label="Headers (JSON)"
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
                  <Callout status="error">Invalid JSON</Callout>
                ) : (
                  <Text>
                    JSON format for headers. Supports{" "}
                    <DocLink docSection="webhookSecrets">
                      Webhook Secrets
                    </DocLink>
                    .
                  </Text>
                )}
              </>
            }
          />
        </Box>
      )}

      <Box mt="4">
        <MultiSelectField
          label="Events"
          value={form.watch("events")}
          placeholder="Choose events"
          sort={false}
          disabled={form.watch("payloadType") === "raw"}
          options={eventWebHookEventOptions}
          formatOptionLabel={(option, meta) =>
            formatWebhookEventOptionLabel(option, meta)
          }
          onChange={(value: string[]) => {
            form.setValue("events", value);
            handleFormValidation();
          }}
        />
      </Box>

      <Box mt="4" className="webhook-filters">
        <Text size="small" weight="medium" mb="2" as="p">
          Apply Filters
        </Text>

        <Box p="3" className="bg-highlight rounded">
          <Box
            className={clsx({
              "select-all": !selectedEnvironments.length,
            })}
          >
            <MultiSelectField
              label={
                <FilterLabel
                  name="Environment"
                  allLabel="Receive notifications for all Environments"
                  isAll={!selectedEnvironments.length}
                  disabled={!selectedEnvironments.length}
                  onSelectAll={() => form.setValue("environments", [])}
                />
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
          </Box>

          <Box
            className={clsx({
              "select-all": !selectedProjects.length,
            })}
          >
            <MultiSelectField
              label={
                <FilterLabel
                  name="Projects"
                  allLabel="Receive notifications for all Projects"
                  isAll={!selectedProjects.length}
                  disabled={!selectedProjects.length}
                  onSelectAll={() => form.setValue("projects", [])}
                />
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
          </Box>

          <Box
            className={clsx("form-group", {
              "select-all": !selectedTags.length,
            })}
          >
            <Box mb="1">
              <FilterLabel
                name="Tags"
                allLabel="Receive notifications for all Tags"
                isAll={!selectedTags.length}
                disabled={!selectedTags.length}
                onSelectAll={() => form.setValue("tags", [])}
              />
            </Box>
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
          </Box>
        </Box>
      </Box>
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
}): React.ReactNode => {
  let invalidStep: never;

  switch (step) {
    case "create":
      if (detailedWebhook(payloadType)) return "Create";
      return (
        <>
          Next{" "}
          <PiCaretRight className="position-relative" style={{ top: -1 }} />
        </>
      );

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
      await onSubmit({ ...values, headers: JSON.parse(values.headers) });
      onClose();
    });
  }, [step, onSubmit, onClose, form, filteredValues]);

  const modalTitle =
    mode.mode === "edit" ? "Edit Webhook" : "Create New Webhook";

  const handleFormValidation = useCallback(() => {
    const formValues = filteredValues(form.getValues());
    if (!validateHeaders(formValues.headers)) return setSubmitEnabled(false);

    const schema = z.object({
      url: z.string().url(),
      name: z.string().trim().min(2),
      enabled: z.boolean(),
      events: z
        .array(
          z
            .string()
            .refine(
              (val) =>
                (notificationEventNames as string[]).includes(val) ||
                /^[a-z]+(\.[a-zA-Z]+)*\.\*$/.test(val),
            ),
        )
        .min(1),
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
      ctaEnabled={submitEnabled}
      submit={async () => {
        await handleSubmit();
      }}
      autoCloseOnSubmit={false}
      close={onClose}
      open={isOpen}
      error={error ?? undefined}
      size="lg"
      secondaryCTA={
        step === "confirm" ? (
          <Button
            variant="ghost"
            icon={<PiArrowLeft />}
            onClick={() => setStep("create")}
          >
            Back
          </Button>
        ) : undefined
      }
      useRadixButton={true}
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
