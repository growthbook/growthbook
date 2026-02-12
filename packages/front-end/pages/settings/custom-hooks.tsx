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
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import useApi from "@/hooks/useApi";
import Callout from "@/ui/Callout";
import LoadingOverlay from "@/components/LoadingOverlay";
import EmptyState from "@/components/EmptyState";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { isCloud } from "@/services/env";

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
      rules: [],
    },
  },
  archived: false,
  owner: "",
  project: "",
  version: 1,
  hasDrafts: false,
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
  rules: {},
  datePublished: null,
  publishedBy: null,
};

const hookTypes: Record<
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
    example: `\n// Example: require a description\nif (!feature.description) {\n  throw new Error("Feature must have a description");\n}`,
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
    example: `\n// Example: require at least one rule in production\nif (!revision.rules.production || revision.rules.production.length === 0) {\n  throw new Error("At least one production rule is required");\n}`,
  },
};

function CustomHooksModal({
  close,
  current,
  onSave,
}: {
  close: () => void;
  current?: CustomHookInterface;
  onSave?: () => void;
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

  const [testValues, setTestValues] = useState<Record<string, string>>(
    Object.fromEntries(
      Object.entries(hookTypeData.availableArguments).map(([k, v]) => [
        k,
        v.testValue,
      ]),
    ),
  );
  const [testResult, setTestResult] = useState<{
    status: "" | "success" | "error";
    returnVal?: string;
    error?: string;
    log?: string;
  }>({ status: "" });

  const runTest = async () => {
    const res = await apiCall<{
      success: boolean;
      returnVal?: string;
      error?: string;
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
      }),
    });
    setTestResult({
      status: res.success ? "success" : "error",
      returnVal: res.returnVal,
      error: res.error,
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
        if (current?.id) {
          await apiCall(`/custom-hooks/${current.id}`, {
            method: "PUT",
            body: JSON.stringify(value),
          });
        } else {
          await apiCall("/custom-hooks", {
            method: "POST",
            body: JSON.stringify(value),
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
              setTestValues(
                Object.fromEntries(
                  Object.entries(
                    hookTypes[value as CustomHookType].availableArguments,
                  ).map(([k, v]) => [k, v.testValue]),
                ),
              );
            }}
          />
          <MultiSelectField
            label={"Projects"}
            placeholder="All projects"
            value={form.watch("projects") || []}
            options={projectOptions}
            onChange={(v) => form.setValue("projects", v)}
            customClassName="label-overflow-ellipsis"
            helpText="Only run this hook for selected projects"
          />
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
          {testResult.status === "success" && (
            <Callout mt="3" status="success">
              Success!
            </Callout>
          )}
          {testResult.status === "error" && (
            <Callout mt="3" status="error">
              Error!
            </Callout>
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

export default function CustomHooksPage() {
  const [modalData, setModalData] = useState<null | true | CustomHookInterface>(
    null,
  );

  const { apiCall } = useAuth();

  const { data, error, mutate } = useApi<{
    customHooks: CustomHookInterface[];
  }>("/custom-hooks");

  if (isCloud()) {
    return (
      <Callout status="error">
        Custom Hooks are not available on GrowthBook Cloud.
      </Callout>
    );
  }

  if (error) {
    return <Callout status="error">Error: {error.message}</Callout>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const hooks = data.customHooks || [];

  return (
    <div className="container-fluid pagecontents">
      {modalData && (
        <CustomHooksModal
          current={modalData === true ? undefined : modalData}
          close={() => setModalData(null)}
          onSave={() => mutate()}
        />
      )}

      {hooks.length === 0 ? (
        <EmptyState
          description="Custom hooks allow you to extend the functionality of GrowthBook by
        writing custom javascript snippets that execute on certain events."
          title="Custom Hooks"
          // TODO: add docs page and link to it here
          leftButton={null}
          rightButton={
            <Button onClick={() => setModalData(true)}>Add Custom Hook</Button>
          }
        />
      ) : (
        <div>
          <Flex justify="between" align="center" mb="3">
            <h1 className="mb-0">Custom Hooks</h1>
            <Button onClick={() => setModalData(true)}>Add Custom Hook</Button>
          </Flex>
          <table className="gbtable table appbox">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Projects</th>
                <th>Enabled</th>
                <th style={{ width: 50 }}></th>
              </tr>
            </thead>
            <tbody>
              {hooks.map((hook) => (
                <tr key={hook.id}>
                  <td data-title="Name">{hook.name}</td>
                  <td data-title="Type">{hook.hook}</td>
                  <td data-title="Projects">{hook.projects.join(", ")}</td>
                  <td data-title="Enabled">{hook.enabled ? "Yes" : "No"}</td>
                  <td>
                    <MoreMenu>
                      <a
                        href="#"
                        className="dropdown-item"
                        onClick={() => setModalData(hook)}
                      >
                        Edit
                      </a>
                      <DeleteButton
                        useIcon={false}
                        text="Delete"
                        displayName="custom hook"
                        onClick={async () => {
                          await apiCall(`/custom-hooks/${hook.id}`, {
                            method: "DELETE",
                          });
                          await mutate();
                        }}
                        className="dropdown-item text-danger"
                      />
                    </MoreMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
