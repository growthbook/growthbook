import { useEffect, useMemo, useRef } from "react";
import { useForm } from "react-hook-form";
import { ConstantInterface, ConstantWithoutValue } from "shared/types/constant";
import { generateTrackingKey } from "shared/experiments";
import { Box, Flex } from "@radix-ui/themes";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import FeatureValueField from "@/components/Features/FeatureValueField";
import Switch from "@/ui/Switch";
import Text from "@/ui/Text";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useEnvironments } from "@/services/features";
import { useUser } from "@/services/UserContext";
import useApi from "@/hooks/useApi";

type FormValues = {
  key: string;
  name: string;
  type: "string" | "json";
  owner: string;
  description: string;
  projects: string[];
  defaultValue: string;
  environmentValues: Record<string, string>;
  // Per-env enable toggles (UI only) — which envs carry an override.
  envEnabled: Record<string, boolean>;
};

export default function ConstantModal({
  existing,
  close,
}: {
  existing: ConstantWithoutValue | null;
  close: () => void;
}) {
  const { apiCall } = useAuth();
  const { mutateDefinitions, getConstantByKey, projects, project } =
    useDefinitions();
  const environments = useEnvironments();
  const { name: currentUserName } = useUser();

  const editing = !!existing;

  // The list only carries the projection (no values) — fetch the full constant
  // when editing so the value editors prefill.
  const { data: fullData } = useApi<{
    status: number;
    constant: ConstantInterface;
  }>(`/constants/${existing?.id}`, { shouldRun: () => editing });
  const full = fullData?.constant;

  const form = useForm<FormValues>({
    defaultValues: {
      key: existing?.key ?? "",
      name: existing?.name ?? "",
      type: existing?.type ?? "string",
      owner: existing?.owner ?? currentUserName ?? "",
      description: existing?.description ?? "",
      projects: existing?.projects ?? (project ? [project] : []),
      defaultValue: "",
      environmentValues: {},
      envEnabled: {},
    },
  });

  // Reset value fields once the full constant loads (edit mode).
  const hydrated = useRef(false);
  useEffect(() => {
    if (!editing || !full || hydrated.current) return;
    hydrated.current = true;
    form.setValue("defaultValue", full.defaultValue ?? "");
    form.setValue("environmentValues", full.environmentValues ?? {});
    form.setValue(
      "envEnabled",
      Object.fromEntries(
        Object.keys(full.environmentValues ?? {}).map((e) => [e, true]),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, full]);

  // Auto-derive the slug key from the name until the user edits the key.
  const keyTouched = useRef(editing);
  const name = form.watch("name");
  useEffect(() => {
    if (editing || keyTouched.current || !name) return;
    let active = true;
    generateTrackingKey({ name }, async (k) => getConstantByKey(k)).then(
      (k) => {
        if (active) form.setValue("key", k);
      },
    );
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, editing]);

  const type = form.watch("type");
  const envEnabled = form.watch("envEnabled");

  const projectOptions = useMemo(
    () => projects.map((p) => ({ label: p.name, value: p.id })),
    [projects],
  );

  return (
    <ModalStandard
      open={true}
      trackingEventModalType="constant-modal"
      header={editing ? "Edit Constant" : "Add Constant"}
      close={close}
      cta={editing ? "Save" : "Create"}
      submit={form.handleSubmit(async (values) => {
        // Only keep enabled, non-empty env overrides.
        const environmentValues: Record<string, string> = {};
        for (const env of environments) {
          if (values.envEnabled[env.id] && values.environmentValues[env.id]) {
            environmentValues[env.id] = values.environmentValues[env.id];
          }
        }

        if (
          !values.defaultValue &&
          Object.keys(environmentValues).length === 0
        ) {
          throw new Error(
            editing
              ? "Set a default value or at least one environment override."
              : "Set a value.",
          );
        }

        const body = {
          name: values.name,
          owner: values.owner,
          type: values.type,
          defaultValue: values.defaultValue || undefined,
          environmentValues: Object.keys(environmentValues).length
            ? environmentValues
            : undefined,
          description: values.description || undefined,
          projects: values.projects,
        };

        if (editing && existing) {
          await apiCall(`/constants/${existing.id}`, {
            method: "PUT",
            body: JSON.stringify(body),
          });
        } else {
          await apiCall(`/constants`, {
            method: "POST",
            body: JSON.stringify({ ...body, key: values.key }),
          });
        }
        await mutateDefinitions();
      })}
    >
      <Field label="Name" required {...form.register("name")} />
      <Field
        label="Key"
        required
        helpText={
          <>
            Reference handle used as{" "}
            <code>{`@const:${form.watch("key") || "key"}`}</code>
          </>
        }
        disabled={editing}
        {...form.register("key", {
          onChange: () => {
            keyTouched.current = true;
          },
        })}
      />
      <SelectField
        label="Type"
        value={type}
        disabled={editing}
        options={[
          { label: "String", value: "string" },
          { label: "JSON", value: "json" },
        ]}
        onChange={(v) => form.setValue("type", v as "string" | "json")}
      />

      {projectOptions.length > 0 && (
        <MultiSelectField
          label="Projects"
          value={form.watch("projects")}
          options={projectOptions}
          onChange={(v) => form.setValue("projects", v)}
        />
      )}

      <Box mb="3">
        <FeatureValueField
          label={editing ? "Default value" : "Value"}
          id="constant-default-value"
          value={form.watch("defaultValue")}
          setValue={(v) => form.setValue("defaultValue", v)}
          valueType={type}
          useCodeInput={type === "json"}
        />
      </Box>

      {/* Description + per-env overrides are configured after creation. */}
      {editing && environments.length > 0 && (
        <Box mb="3">
          <Text as="label" weight="semibold">
            Environment overrides
          </Text>
          {environments.map((env) => (
            <Box key={env.id} mt="2">
              <Flex align="center" gap="2" mb="1">
                <Switch
                  value={!!envEnabled[env.id]}
                  onChange={(v) => form.setValue(`envEnabled.${env.id}`, v)}
                />
                <Text size="small">{env.id}</Text>
              </Flex>
              {envEnabled[env.id] && (
                <FeatureValueField
                  id={`constant-env-${env.id}`}
                  value={form.watch(`environmentValues.${env.id}`) || ""}
                  setValue={(v) =>
                    form.setValue(`environmentValues.${env.id}`, v)
                  }
                  valueType={type}
                  useCodeInput={type === "json"}
                />
              )}
            </Box>
          ))}
        </Box>
      )}

      {editing && (
        <>
          <Field label="Owner" {...form.register("owner")} />
          <Field
            label="Description"
            textarea
            minRows={1}
            {...form.register("description")}
          />
        </>
      )}
    </ModalStandard>
  );
}
