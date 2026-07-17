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
import {
  ExperimentInterface,
  ExperimentInterfaceStringDates,
} from "shared/types/experiment";
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
import { DocLink, DocSection } from "@/components/DocLink";
import InlineCode from "@/components/SyntaxHighlighting/InlineCode";

// Per-hook-type example section in the Custom Hooks docs.
const EXAMPLE_DOC_SECTIONS: Record<CustomHookType, DocSection> = {
  validateFeature: "customHooks#validatefeature",
  validateFeatureRevision: "customHooks#validatefeaturerevision",
  validateConfig: "customHooks#validateconfig",
  validateConfigRevision: "customHooks#validateconfigrevision",
  validateExperiment: "customHooks#validateexperiment",
};

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
const dummyExperiment: ExperimentInterface = {
  id: "exp_abc123",
  uid: "abc123",
  organization: "org_abc123",
  trackingKey: "my-experiment",
  name: "My Experiment",
  project: "",
  status: "draft",
  hypothesis: "",
  description: "",
  tags: [],
  owner: "user@example.com",
  dateCreated: new Date("2024-01-15T00:00:00.000Z"),
  dateUpdated: new Date("2024-01-15T00:00:00.000Z"),
  archived: false,
  autoSnapshots: false,
  hashAttribute: "id",
  hashVersion: 2,
  variations: [
    { id: "v0", key: "0", name: "Control", screenshots: [] },
    { id: "v1", key: "1", name: "Variation 1", screenshots: [] },
  ],
  phases: [],
  datasource: "",
  exposureQueryId: "",
  goalMetrics: [],
  secondaryMetrics: [],
  guardrailMetrics: [],
  decisionFrameworkSettings: {},
  implementation: "code",
  autoAssign: false,
  previewURL: "",
  targetURLRegex: "",
  releasedVariationId: "",
  customFields: {
    contextualAttributes: ["checkout", "mobile"],
    jiraTicket: "PROJ-123",
  },
};

// Parse a JSON string for the test prefill; leave non-JSON text as-is.
const parseJSON = (v: unknown): unknown => {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};

const dummyConfig = {
  key: "checkout_limits",
  name: "Checkout limits",
  project: "",
  // Hooks receive `value` as a parsed object, so the sample shows it as one.
  value: { maxItems: 50, currency: "USD" },
  schema: {
    type: "object",
    fields: [
      {
        key: "maxItems",
        type: "integer",
        required: true,
        default: "10",
        description: "Max items allowed in a cart",
        enum: [],
      },
      {
        key: "currency",
        type: "string",
        required: true,
        default: "USD",
        description: "",
        enum: [],
      },
    ],
  },
  extensible: true,
  lineage: {
    ancestors: ["base_limits"],
    descendants: [],
    hasParent: true,
    hasChildren: false,
    isRoot: false,
    isLeaf: true,
  },
  // Whether this config is the one the hook is pinned to, vs a descendant it
  // also runs on. `hookTargetKey` is the pinned config (null for project hooks).
  hookTargetKey: "checkout_limits",
  isHookTarget: true,
  // Present only when the config is an environment/project override ("flavor")
  // of another config — its base and the scope it applies to. A plain config
  // omits this. Shown here so env-aware validation can be tested; delete it to
  // simulate a non-override config.
  scopedConfig: {
    parent: "base_limits",
    environments: ["production"],
  },
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
        description:
          "The config being validated: schema fields, staged value (parsed JSON object), lineage, isHookTarget (is this the config the hook is pinned to, vs a descendant), and scopedConfig (present only for an environment/project override — its base and the environments/projects it applies to)",
        testValue: stringify(dummyConfig),
      },
    },
    example: `\n// config.value is a parsed object — no JSON.parse needed.\n// Block the save (hard error):\nif ((config.value.maxItems ?? 0) > 100) {\n  throw new Error("maxItems cannot exceed 100");\n}\n\n// Or raise a soft warning the user can acknowledge:\nif (!config.name) {\n  addWarning("Consider naming this config");\n}`,
  },
  validateConfigRevision: {
    label: "Validate Config Revision",
    availableArguments: {
      config: {
        description:
          "The config's changed content: schema fields, value (parsed JSON object), lineage, isHookTarget (is this the config the hook is pinned to, vs a descendant), and scopedConfig (present only for an environment/project override — its base and the environments/projects it applies to)",
        testValue: stringify(dummyConfig),
      },
      revision: {
        description:
          "Publish metadata for approval gating (version, status, reviews). The changed content is in `config`.",
        testValue: stringify(dummyConfigRevision),
      },
    },
    example: `\n// config.value is a parsed object — no JSON.parse needed.\n// Block the publish (hard error):\nif ((config.value.maxItems ?? 0) > 100) {\n  throw new Error("maxItems cannot exceed 100");\n}\n\n// Gate on approval policy:\nif (revision) {\n  const approvals = (revision.reviews || []).filter(r => r.decision === "approve" && !r.stale);\n  if (!approvals.some(r => r.userId === "key_abc123")) {\n    throw new Error("Requires release-bot approval");\n  }\n}`,
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
  validateExperiment: {
    label: "Validate Experiment",
    availableArguments: {
      experiment: {
        description: "The experiment being created or updated",
        testValue: stringify(dummyExperiment),
      },
    },
    example: `\n// Block the save (hard error):\nconst attributes = experiment.customFields?.contextualAttributes || [];\nif (!attributes.length) {\n  throw new Error("Select at least one contextual attribute");\n}\n\n// Or raise a soft warning the user can acknowledge:\nif (!experiment.hypothesis) {\n  addWarning("Consider adding a hypothesis");\n}`,
  },
};

export default function CustomHookModal({
  close,
  current,
  onSave,
  feature,
  experiment,
  revision,
  config,
}: {
  close: () => void;
  current?: CustomHookInterface;
  onSave?: () => void;
  // When set, scopes the hook to this feature and hides the Projects field.
  feature?: FeatureInterface;
  // When set, scopes the hook to this experiment and hides the Projects field.
  experiment?: ExperimentInterfaceStringDates;
  // Prefills the revision test argument
  revision?: FeatureRevisionInterface;
  // When set, scopes the hook to this config and hides the Projects field.
  // `schema`/`lineage` enrich the test prefill to mirror what hooks receive.
  config?: {
    key: string;
    project?: string;
    name?: string;
    value?: string;
    schema?: unknown;
    lineage?: {
      ancestors: string[];
      descendants: string[];
      hasParent: boolean;
      hasChildren: boolean;
      isRoot: boolean;
      isLeaf: boolean;
    };
  };
}) {
  // The entity this modal is scoped to (feature or config), if any. Drives the
  // hook-type options, the hidden Projects field, and the submit/test scope.
  const scope: "feature" | "config" | "experiment" | null = feature
    ? "feature"
    : experiment
      ? "experiment"
      : config
        ? "config"
        : null;
  const defaultHook: CustomHookType =
    current?.hook ||
    (scope === "config"
      ? "validateConfigRevision"
      : scope === "experiment"
        ? "validateExperiment"
        : "validateFeature");

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
  const exampleDocSection = EXAMPLE_DOC_SECTIONS[hookType];

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
          : experiment && k === "experiment"
            ? stringify(experiment)
            : revision && k === "revision"
              ? stringify(revision)
              : config && k === "config"
                ? // Mirror the runtime shape: parsed value + this config as the
                  // hook's pinned target (a hook created here scopes to it).
                  stringify({
                    ...config,
                    value: parseJSON(config.value),
                    hookTargetKey: config.key,
                    isHookTarget: true,
                  })
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
    try {
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
            : experiment
              ? { entityType: "experiment" as const, entityId: experiment.id }
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
    } catch (e) {
      setTestResult({ status: "error", error: e.message });
    }
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
            : experiment
              ? {
                  projects: [],
                  entityType: "experiment" as const,
                  entityId: experiment.id,
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
              placeholder="All Projects"
              value={form.watch("projects") || []}
              options={projectOptions}
              onChange={(v) => form.setValue("projects", v)}
              customClassName="label-overflow-ellipsis"
              helpText="Only run this hook for selected projects"
            />
          )}
          {scope === "config" && (
            <Callout status="info" mb="3">
              This hook applies to {config?.key} and all of its descendant
              configs.
            </Callout>
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

          <Callout status="info" mb="4">
            <Flex align="baseline" wrap="wrap" gapX="2">
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
            placeholder="// Your validation logic (throw to block, addWarning to warn)"
            onCtrlEnter={runTest}
            containerClassName="mb-0"
            showCopyButton
            showFullscreenButton
          />
          <Text as="div" size="small" color="text-low" mt="1" mb="5">
            Need a starting point? See an{" "}
            <DocLink docSection={exampleDocSection}>
              example {hookEntityType[hookType]} hook
            </DocLink>
            .
          </Text>

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
              showCopyButton
              showFullscreenButton
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
