import React, { useState } from "react";
import { useRouter } from "next/router";
import { useForm } from "react-hook-form";
import { generateTrackingKey } from "shared/experiments";
import { Box, Flex } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import PageHead from "@/components/Layout/PageHead";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";

// First-cut Config create flow. A base config takes a JSON object of field
// values; a child config picks a parent (lineage) and overrides a subset. Field
// schemas are a follow-up — for now the editor surfaces whatever value keys
// exist, so you can play with inheritance/overrides immediately.
export default function NewConfigPage(): React.ReactElement {
  const router = useRouter();
  const { apiCall } = useAuth();
  const { constants, projects, project, mutateDefinitions } = useDefinitions();

  const parentFromQuery =
    typeof router.query.parent === "string" ? router.query.parent : "";

  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      name: "",
      key: "",
      parent: parentFromQuery,
      project: project ?? "",
      value: "{}",
    },
  });

  const configOptions = constants
    .filter((c) => c.type === "config" && !c.archived)
    .map((c) => ({ label: `${c.name} (${c.key})`, value: c.key }));

  const name = form.watch("name");
  React.useEffect(() => {
    if (form.getValues("key") || !name) return;
    generateTrackingKey({ name }, async () => null).then((k) =>
      form.setValue("key", k),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  return (
    <>
      <PageHead
        breadcrumb={[
          { display: "Configs", href: "/configs" },
          { display: "New config" },
        ]}
      />
      <Box className="contents container-fluid pagecontents" mt="2">
        <Heading as="h1" size="x-large" mb="3">
          New config
        </Heading>
        <Box style={{ maxWidth: 640 }}>
          <Field label="Name" required {...form.register("name")} />
          <Field
            label="Key"
            required
            helpText="Stable reference handle, referenced as @const:key"
            {...form.register("key")}
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
          <Field
            label="Field values (JSON object)"
            textarea
            minRows={5}
            helpText="A base config's fields, or a child's overrides."
            {...form.register("value")}
          />
          {error && (
            <Text as="p" color="text-mid" mb="2">
              {error}
            </Text>
          )}
          <Flex gap="3" mt="2">
            <Button
              onClick={form.handleSubmit(async (values) => {
                setError(null);
                let parsed: Record<string, unknown>;
                try {
                  const p = JSON.parse(values.value || "{}");
                  if (p === null || typeof p !== "object" || Array.isArray(p)) {
                    throw new Error("Value must be a JSON object");
                  }
                  parsed = p;
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Invalid JSON");
                  return;
                }
                const value = values.parent
                  ? { $extends: [`@const:${values.parent}`], ...parsed }
                  : parsed;
                try {
                  await apiCall(`/constants`, {
                    method: "POST",
                    body: JSON.stringify({
                      key: values.key,
                      name: values.name,
                      type: "config",
                      value: JSON.stringify(value),
                      project: values.project || undefined,
                    }),
                  });
                  await mutateDefinitions();
                  await router.push(`/configs/${values.key}`);
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Failed to create");
                }
              })}
            >
              Create config
            </Button>
            <Button variant="outline" onClick={() => router.push("/configs")}>
              Cancel
            </Button>
          </Flex>
        </Box>
      </Box>
    </>
  );
}
