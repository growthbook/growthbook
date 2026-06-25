import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { useForm } from "react-hook-form";
import { generateTrackingKey } from "shared/experiments";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import Callout from "@/ui/Callout";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";

// Lightweight create-only modal for a config (mirrors ConstantModal, minus the
// value/schema editing — all field and schema editing happens on the config's
// detail page). A child config picks a parent; the value is seeded with the
// `$extends` lineage ref and everything else is filled in on the editor.
export default function ConfigModal({
  parentKey,
  close,
}: {
  // Pre-selected parent when creating an override config from a parent's editor.
  parentKey?: string;
  close: () => void;
}) {
  const router = useRouter();
  const { apiCall } = useAuth();
  const {
    configs,
    projects,
    project,
    mutateDefinitions,
    getConfigByKey,
    getConstantByKey,
  } = useDefinitions();

  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      name: "",
      key: "",
      parent: parentKey ?? "",
      project: project ?? "",
    },
  });

  const configOptions = configs
    .filter((c) => !c.archived)
    .map((c) => ({ label: `${c.name} (${c.key})`, value: c.key }));

  // Auto-derive the slug key from the name until the user edits the key.
  const keyTouched = useRef(false);
  const name = form.watch("name");
  useEffect(() => {
    if (keyTouched.current || !name) return;
    let active = true;
    // Keys are unique across both configs and constants — check both so an
    // auto-generated slug doesn't collide with a constant.
    generateTrackingKey(
      { name },
      async (k) => getConfigByKey(k) ?? getConstantByKey(k),
    ).then((k) => {
      if (active) form.setValue("key", k);
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  return (
    <ModalStandard
      open={true}
      trackingEventModalType="config-create-modal"
      header="New config"
      size="lg"
      close={close}
      cta="Create"
      submit={form.handleSubmit(async (values) => {
        setError(null);
        const value = values.parent
          ? JSON.stringify({ $extends: [`@const:${values.parent}`] })
          : undefined;
        try {
          await apiCall(`/configs`, {
            method: "POST",
            body: JSON.stringify({
              key: values.key,
              name: values.name,
              ...(value ? { value } : {}),
              project: values.project || undefined,
            }),
          });
          await mutateDefinitions();
          await router.push(`/configs/${values.key}`);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Failed to create config");
        }
      })}
    >
      <Callout status="info" mb="3">
        Configs are referenced from a feature flag — define the fields and
        values here, then reference the config from a flag to deliver it to your
        SDKs.
      </Callout>
      <Field label="Name" required {...form.register("name")} />
      <Field
        label="Key"
        required
        helpText="Stable reference handle, referenced as @const:key"
        {...form.register("key", {
          onChange: () => {
            keyTouched.current = true;
          },
        })}
      />
      <SelectField
        label="Parent config (optional)"
        value={form.watch("parent")}
        onChange={(v) => form.setValue("parent", v)}
        options={configOptions}
        initialOption="None (base config)"
        helpText="A child inherits its parent's fields and overrides a subset."
      />
      {projects.length > 0 && (
        <SelectField
          label="Project"
          value={form.watch("project")}
          onChange={(v) => form.setValue("project", v)}
          options={projects.map((p) => ({ label: p.name, value: p.id }))}
          initialOption="All projects"
        />
      )}
      {error && (
        <Callout status="error" mt="2">
          {error}
        </Callout>
      )}
    </ModalStandard>
  );
}
