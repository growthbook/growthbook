import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { CustomHookInterface, CustomHookType } from "shared/validators";
import { CreateProps } from "shared/types/base-model";
import { Flex, Kbd, Separator } from "@radix-ui/themes";
import stringify from "json-stringify-pretty-compact";
import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import useProjectOptions from "@/hooks/useProjectOptions";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import CodeTextArea from "@/components/Forms/CodeTextArea";
import Checkbox from "@/ui/Checkbox";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";

const dummyFeature: FeatureInterface = {
  id: "new-feature",
  organization: "org_abc123",
  dateCreated: new Date(),
  dateUpdated: new Date(),
  description: "My new feature",
  valueType: "boolean",
  defaultValue: "false",
  tags: [],
  environmentSettings: {
    production: {
      enabled: true,
    },
  },
  rules: [],
  archived: false,
  owner: "",
  project: "",
  version: 1,
  prerequisites: [],
  customFields: {},
};
const dummyRevision: FeatureRevisionInterface = {
  organization: "org_abc123",
  featureId: "new-feature",
  dateCreated: new Date(),
  dateUpdated: new Date(),
  version: 2,
  baseVersion: 1,
  comment: "",
  createdBy: {
    type: "dashboard",
    id: "user_123",
    name: "User",
    email: "user@example.com",
  },
  defaultValue: "false",
  status: "draft",
  rules: [],
  datePublished: null,
  publishedBy: null,
};

export const hookTypes: Record<
  CustomHookType,
  {
    label: string;
    availableArguments: Record<
      string,
      { description: string; testValue: string }
    >;
    example: string;
  }
> = {
  validateFeature: {
    label: "Validate Feature",
    availableArguments: {
      feature: {
        description: "The feature object being validated",
        testValue: stringify(dummyFeature),
      },
    },
    example: `\n// Block the save (hard error):\nif (!feature.description) {\n  throw new Error("Feature must have a description");\n}\n\n// Or raise a soft warning the user can acknowledge:\nif (feature.tags.length === 0) {\n  addWarning("Consider adding at least one tag");\n}`,
  },
  validateFeatureRevision: {
    label: "Validate Feature Revision",
    availableArguments: {
      feature: {
        description: "The feature object the revision belongs to",
        testValue: stringify(dummyFeature),
      },
      revision: {
        description: "The feature revision being validated",
        testValue: stringify(dummyRevision),
      },
    },
    example: `\n// Block the save (hard error):\nif (!revision.rules.production || revision.rules.production.length === 0) {\n  throw new Error("At least one production rule is required");\n}\n\n// Or raise a soft warning the user can acknowledge:\nif (!revision.comment) {\n  addWarning("Consider adding a comment describing this change");\n}`,
  },
};

export default function CustomHookModal({
  close,
  current,
  onSave,
  feature,
}: {
  close: () => void;
  current?: CustomHookInterface;
  onSave?: () => void;
  // When set, the hook is scoped to this specific feature (entityType/entityId)
  // and the Projects field is hidden.
  feature?: FeatureInterface;
}) {
  const form = useForm<CreateProps<CustomHookInterface>>({
    defaultValues: {
      name: current?.name || "",
      hook: current?.hook || "validateFeature",
      code: current?.code || "",
      projects: current?.projects || [],
      enabled: current?.enabled ?? true,
      incrementalChangesOnly: current?.incrementalChangesOnly || false,
    },
  });

  const { apiCall } = useAuth();

  const projectOptions = useProjectOptions(() => true, current?.projects || []);

  const hookType = form.watch("hook");
  const hookTypeData = hookTypes[hookType];

  // For a feature-scoped hook, prefill the `feature` argument with the real
  // feature so testing reflects the actual object being validated.
  const initialTestValues = (h: CustomHookType): Record<string, string> =>
    Object.fromEntries(
      Object.entries(hookTypes[h].availableArguments).map(([k, v]) => [
        k,
        feature && k === "feature" ? stringify(feature) : v.testValue,
      ]),
    );

  const [testValues, setTestValues] = useState<Record<string, string>>(
    initialTestValues(current?.hook || "validateFeature"),
  );
  const [testResult, setTestResult] = useState<{
    status: "" | "success" | "error";
    returnVal?: string;
    error?: string;
    warnings?: string[];
    log?: string;
  }>({ status: "" });

  const runTest = async () => {
    const res = await apiCall<{
      success: boolean;
      returnVal?: string;
      error?: string;
      warnings?: string[];
      log?: string;
    }>("/custom-hooks/test", {
      method: "POST",
      body: JSON.stringify({
        functionBody: form.getValues("code"),
        functionArgs: Object.fromEntries(
          Object.entries(testValues).map(([k, v]) => {
            try {
              return [k, JSON.parse(v)];
            } catch (e) {
              return [k, v];
            }
          }),
        ),
        ...(feature
          ? { entityType: "feature" as const, entityId: feature.id }
          : {}),
      }),
    });
    setTestResult({
      status: res.success ? "success" : "error",
      returnVal: res.returnVal,
      error: res.error,
      warnings: res.warnings,
      log: res.log,
    });
  };

  const isMac =
    typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");
  const modKey = isMac ? "⌘" : "Ctrl";

  return (
    <Modal
      header={current?.id ? "Edit Custom Hook" : "Add Custom Hook"}
      close={close}
      open={true}
      size="max"
      trackingEventModalType="custom-hooks"
      submit={form.handleSubmit(async (value) => {
        const body = feature
          ? {
              ...value,
              projects: [],
              entityType: "feature" as const,
              entityId: feature.id,
            }
          : value;
        if (current?.id) {
          await apiCall(`/custom-hooks/${current.id}`, {
            method: "PUT",
            body: JSON.stringify(body),
          });
        } else {
          await apiCall("/custom-hooks", {
            method: "POST",
            body: JSON.stringify(body),
          });
        }

        if (onSave) onSave();
      })}
    >
      <Flex align="start" gap="5">
        <div style={{ width: "50%" }} className="border-right pr-4">
          <Field label="Name" required {...form.register("name")} />
          <SelectField
            label="Hook Type"
            required
            options={Object.entries(hookTypes).map(([value, { label }]) => ({
              value,
              label,
            }))}
            value={hookType}
            onChange={(value) => {
              form.setValue("hook", value as CustomHookType);
              setTestValues(initialTestValues(value as CustomHookType));
            }}
          />
          {!feature && (
            <MultiSelectField
              label={"Projects"}
              placeholder="All projects"
              value={form.watch("projects") || []}
              options={projectOptions}
              onChange={(v) => form.setValue("projects", v)}
              customClassName="label-overflow-ellipsis"
              helpText="Only run this hook for selected projects"
            />
          )}
          <Checkbox
            label="Enable this hook"
            value={form.watch("enabled")}
            setValue={(value) => form.setValue("enabled", value)}
            description="Uncheck to disable this hook without deleting it"
          />

          <Separator size="4" mb="4" my="2" />

          <strong>Available Variables</strong>
          <ul>
            {Object.entries(hookTypeData?.availableArguments).map(
              ([arg, { description }]) => (
                <li key={arg}>
                  <code>{arg}</code>: {description}
                </li>
              ),
            )}
          </ul>

          <Text as="p" size="small" color="text-low" mb="2">
            Call <code>throw new Error(...)</code> to block the action, or{" "}
            <code>addWarning(...)</code> for a soft warning the user can
            acknowledge and override.
          </Text>

          <CodeTextArea
            language="javascript"
            label="Javascript Code"
            required
            value={form.watch("code")}
            setValue={(value) => form.setValue("code", value)}
            placeholder={hookTypeData?.example || ""}
            onCtrlEnter={runTest}
          />

          <Checkbox
            label="Incremental Changes Only"
            value={form.watch("incrementalChangesOnly") || false}
            setValue={(value) => form.setValue("incrementalChangesOnly", value)}
            description="Ignore this hook if the same error was already present before attempting to save."
          />
        </div>
        <div style={{ width: "50%" }}>
          <h3>Test Your Hook</h3>
          {Object.keys(hookTypeData?.availableArguments).map((arg) => (
            <CodeTextArea
              language="json"
              key={arg}
              label={arg}
              required
              value={testValues[arg] || ""}
              setValue={(value) =>
                setTestValues((existing) => ({
                  ...existing,
                  [arg]: value,
                }))
              }
              onCtrlEnter={runTest}
              maxLines={8}
            />
          ))}
          <Button
            onClick={runTest}
            disabled={!form.watch("code")}
            variant="outline"
          >
            <Flex align="center" gap="3">
              <Text>Run Test</Text>
              <Kbd size="1">{modKey} + Enter</Kbd>
            </Flex>
          </Button>
          {testResult.status === "success" && !testResult.warnings?.length && (
            <Callout mt="3" status="success">
              Success!
            </Callout>
          )}
          {testResult.status === "error" && (
            <Callout mt="3" status="error">
              Error!
            </Callout>
          )}
          {testResult.warnings && testResult.warnings.length > 0 && (
            <div className="mt-3">
              <strong>Warnings:</strong>
              {testResult.warnings.map((w, i) => (
                <Callout key={i} status="warning" mt="2">
                  {w}
                </Callout>
              ))}
            </div>
          )}
          {testResult.returnVal && (
            <div className="mt-3">
              <strong>Return Value:</strong>
              <pre className="p-3 bg-light">{testResult.returnVal}</pre>
            </div>
          )}
          {testResult.error && (
            <div className="mt-3">
              <strong>Error:</strong>
              <pre className="p-3 bg-light">{testResult.error}</pre>
            </div>
          )}
          {testResult.log && (
            <div className="mt-3">
              <strong>Log:</strong>
              <pre className="p-3 bg-light">{testResult.log}</pre>
            </div>
          )}
        </div>
      </Flex>
    </Modal>
  );
}
