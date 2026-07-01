import React, { useState } from "react";
import { useForm } from "react-hook-form";
import {
  CustomHookInterface,
  CustomHookType,
  hookEntityType,
} from "shared/validators";
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
import InlineCode from "@/components/SyntaxHighlighting/InlineCode";

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
  status: "approved",
  rules: [],
  datePublished: null,
  publishedBy: null,
  reviews: [
    {
      userId: "user_456",
      user: {
        type: "dashboard",
        id: "user_456",
        name: "Reviewer",
        email: "reviewer@example.com",
      },
      status: "approved",
      timestamp: new Date(),
    },
    {
      userId: "key_abc123",
      user: { type: "api_key", apiKey: "key_abc123" },
      status: "approved",
      timestamp: new Date(),
    },
  ],
};

const dummyConfig = {
  key: "checkout_limits",
  name: "Checkout limits",
  project: "",
  value: JSON.stringify({ maxItems: 50, currency: "USD" }),
  schema: { type: "object", fields: [] },
  extensible: true,
};
const dummyConfigRevision = {
  version: 3,
  status: "approved",
  comment: "Raise the checkout item limit",
  authorId: "user_123",
  contributors: ["user_123"],
  reviews: [
    {
      userId: "user_456",
      decision: "approve",
      comment: "",
      stale: false,
      dateCreated: new Date(),
    },
    {
      userId: "key_abc123",
      decision: "approve",
      comment: "",
      stale: false,
      dateCreated: new Date(),
    },
  ],
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
  validateConfig: {
    label: "Validate Config",
    availableArguments: {
      config: {
        description: "The config being validated (its fields + staged value)",
        testValue: stringify(dummyConfig),
      },
    },
    example: `\n// Block the save (hard error):\nif (!config.value) {\n  throw new Error("Config must have a value");\n}\n\n// Or raise a soft warning the user can acknowledge:\nif (!config.name) {\n  addWarning("Consider naming this config");\n}`,
  },
  validateConfigRevision: {
    label: "Validate Config Revision",
    availableArguments: {
      config: {
        description:
          "The config's published content (key, value, schema, lineage)",
        testValue: stringify(dummyConfig),
      },
      revision: {
        description:
          "The revision being published (version, status, reviews) — for approval gating",
        testValue: stringify(dummyConfigRevision),
      },
    },
    example: `\n// Block the publish (hard error):\nconst v = JSON.parse(config.value || "{}");\nif (v.maxItems > 100) {\n  throw new Error("maxItems cannot exceed 100");\n}\n\n// Gate on approval policy:\nif (revision) {\n  const approvals = (revision.reviews || []).filter(r => r.decision === "approve" && !r.stale);\n  if (!approvals.some(r => r.userId === "key_abc123")) {\n    throw new Error("Requires release-bot approval");\n  }\n}`,
  },
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
  revision,
  config,
}: {
  close: () => void;
  current?: CustomHookInterface;
  onSave?: () => void;
  // When set, scopes the hook to this feature and hides the Projects field.
  feature?: FeatureInterface;
  // Prefills the revision test argument
  revision?: FeatureRevisionInterface;
  // When set, scopes the hook to this config and hides the Projects field.
  config?: { key: string; project?: string; name?: string; value?: string };
}) {
  // The entity this modal is scoped to (feature or config), if any. Drives the
  // hook-type options, the hidden Projects field, and the submit/test scope.
  const scope: "feature" | "config" | null = feature
    ? "feature"
    : config
      ? "config"
      : null;
  const defaultHook: CustomHookType =
    current?.hook ||
    (scope === "config" ? "validateConfigRevision" : "validateFeature");

  const form = useForm<CreateProps<CustomHookInterface>>({
    defaultValues: {
      name: current?.name || "",
      hook: defaultHook,
      code: current?.code || "",
      projects: current?.projects || [],
      incrementalChangesOnly: current?.incrementalChangesOnly ?? true,
    },
  });

  const { apiCall } = useAuth();

  const projectOptions = useProjectOptions(() => true, current?.projects || []);

  const hookType = form.watch("hook");
  const hookTypeData = hookTypes[hookType];

  // Hook types offered: filtered to the scoped entity's types, else all.
  const hookTypeOptions = Object.entries(hookTypes)
    .filter(([value]) =>
      scope ? hookEntityType[value as CustomHookType] === scope : true,
    )
    .map(([value, { label }]) => ({ value, label }));

  const initialTestValues = (h: CustomHookType): Record<string, string> =>
    Object.fromEntries(
      Object.entries(hookTypes[h].availableArguments).map(([k, v]) => [
        k,
        feature && k === "feature"
          ? stringify(feature)
          : revision && k === "revision"
            ? stringify(revision)
            : config && k === "config"
              ? stringify(config)
              : v.testValue,
      ]),
    );

  const [testValues, setTestValues] = useState<Record<string, string>>(
    initialTestValues(defaultHook),
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
          : config
            ? { entityType: "config" as const, entityId: config.key }
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
      useRadixButton={false}
      header={current?.id ? "Edit Custom Hook" : "Add Custom Hook"}
      close={close}
      open={true}
      size="max"
      trackingEventModalType="custom-hooks"
      submit={form.handleSubmit(async (value) => {
        const body = {
          ...value,
          enabled: current?.enabled ?? true,
          ...(feature
            ? {
                projects: [],
                entityType: "feature" as const,
                entityId: feature.id,
              }
            : config
              ? {
                  projects: [],
                  entityType: "config" as const,
                  entityId: config.key,
                }
              : {}),
        };
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
            options={hookTypeOptions}
            value={hookType}
            onChange={(value) => {
              form.setValue("hook", value as CustomHookType);
              setTestValues(initialTestValues(value as CustomHookType));
            }}
          />
          {!scope && (
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
          <Separator size="4" mb="4" my="2" />

          <strong>Available Variables</strong>
          <ul>
            {Object.entries(hookTypeData?.availableArguments).map(
              ([arg, { description }]) => (
                <li key={arg}>
                  <strong>{arg}</strong>: {description}
                </li>
              ),
            )}
          </ul>

          <Callout status="info" mb="4" contentsAs="div">
            <Flex align="center" wrap={"wrap"} gapX={"2"}>
              <Text as="span">Call</Text>
              <InlineCode
                language="javascript"
                code="throw new Error('...')"
              />{" "}
              <Text>to block the action, or</Text>
              <InlineCode language="javascript" code="addWarning('...')" />{" "}
              <Text>
                for a soft warning the user can acknowledge and override.
              </Text>
            </Flex>
          </Callout>

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
            value={form.watch("incrementalChangesOnly") ?? true}
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
              <pre
                className="p-3 bg-light"
                style={{
                  whiteSpace: "pre-wrap",
                  maxHeight: 200,
                  overflowY: "auto",
                }}
              >
                {testResult.log}
              </pre>
            </div>
          )}
        </div>
      </Flex>
    </Modal>
  );
}
