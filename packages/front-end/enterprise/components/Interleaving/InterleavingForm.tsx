import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import { useForm } from "react-hook-form";
import { Box } from "@radix-ui/themes";
import { interleavingEndpoints } from "shared/api-endpoints";
import type { ApiInterleavingInterface } from "shared/validators";
import { useRestApiCall } from "@/services/restApi";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useInterleavingExposureQueries } from "@/hooks/useInterleavings";
import { useUser } from "@/services/UserContext";
import { useAttributeSchema, useEnvironments } from "@/services/features";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import PagedModal from "@/components/Modal/PagedModal";
import Page from "@/components/Modal/Page";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import SelectOwner from "@/components/Owner/SelectOwner";
import TagsInput from "@/components/Tags/TagsInput";
import EnvironmentSelect from "@/components/Features/FeatureModal/EnvironmentSelect";
import type { InterleavingRankers } from "@/components/Interleaving/InterleavingVariationsInput";
import InterleavingAnalysisFields, {
  getAnalysisError,
  InterleavingAnalysisValue,
} from "@/components/Interleaving/InterleavingAnalysisFields";
import AddEditInterleavingExposureQueryModal from "@/components/Interleaving/AddEditInterleavingExposureQueryModal";
import { rankersOf } from "@/components/Interleaving/EditInterleavingRankersModal";

const DEFAULT_RANKERS: InterleavingRankers = {
  control: { key: "control", name: "Control", config: "{}" },
  treatment: { key: "treatment", name: "Treatment", config: "{}" },
};

function keyFromName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-.:|]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// The response carries a server-stamped `date` the create body rejects.
function schemaInput(
  jsonSchema: ApiInterleavingInterface["jsonSchema"] | undefined,
) {
  if (!jsonSchema) return undefined;
  const { date: _date, ...input } = jsonSchema;
  return input;
}

function assertNoError(error: string | null) {
  if (error) throw new Error(error);
}

type InterleavingFormValues = {
  project: string;
  name: string;
  key: string;
  owner: string;
  tags: string[];
  hashAttribute: string;
};

export default function InterleavingForm({
  onClose,
  initialValue,
  duplicate,
}: {
  onClose: () => void;
  // Prefilled copy for Duplicate. `key` is carried over deliberately: several
  // experiments may share one so you can iterate without changing code, and
  // the serving conflict is only checked on Start.
  initialValue?: ApiInterleavingInterface;
  duplicate?: boolean;
}) {
  const router = useRouter();
  const restApiCall = useRestApiCall();
  const permissionsUtil = usePermissionsUtil();
  const {
    project: currentProject,
    projects,
    refreshTags,
    getDatasourceById,
  } = useDefinitions();
  const { userId } = useUser();

  const [step, setStep] = useState(0);
  const [keyEdited, setKeyEdited] = useState(!!initialValue);
  const [addingQuery, setAddingQuery] = useState(false);
  const [analysis, setAnalysis] = useState<InterleavingAnalysisValue>({
    datasourceId: initialValue?.datasourceId ?? "",
    interleavingExposureQueryId:
      initialValue?.interleavingExposureQueryId ?? "",
    userIdType: initialValue?.userIdType ?? "",
    metrics: initialValue?.metrics ?? [],
  });

  // Resolved against the starting project, like ContextualBanditForm. A copy
  // keeps the original's attribute; a new one falls back to the project's.
  const initialProject = initialValue?.project ?? currentProject;
  const initialAttributeSchema = useAttributeSchema(false, initialProject);
  const initialHashAttribute = useMemo(() => {
    if (initialValue?.hashAttribute) return initialValue.hashAttribute;
    const available = initialAttributeSchema
      .filter((attribute) => attribute.hashAttribute)
      .map((attribute) => attribute.property);
    return available.includes("id") ? "id" : (available[0] ?? "id");
  }, [initialValue?.hashAttribute, initialAttributeSchema]);

  const form = useForm<InterleavingFormValues>({
    defaultValues: {
      project: initialProject,
      name: initialValue ? `${initialValue.name} (Copy)` : "",
      key: initialValue?.key ?? "",
      owner: initialValue?.owner || userId || "",
      tags: initialValue?.tags ?? [],
      hashAttribute: initialHashAttribute,
    },
  });
  const project = form.watch("project");
  const attributeSchema = useAttributeSchema(false, project);
  const hashAttributes = useMemo(
    () =>
      attributeSchema
        .filter((attribute) => attribute.hashAttribute)
        .map((attribute) => attribute.property),
    [attributeSchema],
  );

  // Only on a real Project change, and only when the current attribute isn't
  // offered by the new one. Resetting unconditionally would discard a copy's
  // attribute on mount; leaving it alone would submit one the server rejects.
  const previousProject = useRef(initialProject);
  const hashAttribute = form.watch("hashAttribute");
  useEffect(() => {
    if (previousProject.current === project) return;
    previousProject.current = project;
    if (hashAttributes.includes(hashAttribute)) return;
    form.setValue(
      "hashAttribute",
      hashAttributes.includes("id") ? "id" : (hashAttributes[0] ?? "id"),
    );
  }, [form, hashAttributes, hashAttribute, project]);

  const canCreate = permissionsUtil.canCreateInterleaving({ project });

  const environments = useEnvironments();
  const canEnableEnvironment = (envId: string) =>
    permissionsUtil.canRunInterleaving({ project }, [envId]);
  const [environmentSettings, setEnvironmentSettings] = useState(() =>
    Object.fromEntries(
      environments.map((e) => [
        e.id,
        {
          // A copy keeps the original's key, which can only serve in one
          // environment at a time, so start it everywhere off.
          enabled:
            !duplicate &&
            (e.defaultState ?? true) &&
            canEnableEnvironment(e.id),
        },
      ]),
    ),
  );

  const validateOverview = async () => {
    if (!form.watch("name").trim()) throw new Error("Name is required");
    if (!form.watch("key")) throw new Error("Key is required");
  };

  const submit = form.handleSubmit(async (data) => {
    assertNoError(getAnalysisError(analysis));
    const res = await restApiCall(interleavingEndpoints.createInterleaving, {
      body: {
        name: data.name.trim(),
        key: data.key,
        project: data.project || undefined,
        owner: data.owner || undefined,
        tags: data.tags,
        hashAttribute: data.hashAttribute,
        variations: initialValue ? rankersOf(initialValue) : DEFAULT_RANKERS,
        environmentSettings: Object.fromEntries(
          Object.entries(environmentSettings).map(([id, s]) => [
            id,
            { ...s, enabled: s.enabled && canEnableEnvironment(id) },
          ]),
        ),
        jsonSchema: schemaInput(initialValue?.jsonSchema),
        coverage: initialValue?.coverage,
        condition: initialValue?.condition,
        savedGroups: initialValue?.savedGroups,
        prerequisites: initialValue?.prerequisites,
        ...analysis,
      },
    });
    if (data.tags.length) await refreshTags(data.tags);
    router.push(`/interleaving/${res.interleaving.id}`);
  });

  const { mutate: mutateQueries } = useInterleavingExposureQueries(
    analysis.datasourceId,
  );
  const analysisDatasource = analysis.datasourceId
    ? getDatasourceById(analysis.datasourceId)
    : null;

  // Swap modals because Radix renders beneath the legacy PagedModal portal.
  if (addingQuery && analysisDatasource) {
    return (
      <AddEditInterleavingExposureQueryModal
        dataSource={analysisDatasource}
        mode="add"
        onSave={async (q) => {
          await mutateQueries();
          setAnalysis((prev) => ({
            ...prev,
            interleavingExposureQueryId: q.id,
            userIdType: q.userIdTypes[0] ?? "",
            metrics: [],
          }));
          setAddingQuery(false);
        }}
        onCancel={() => setAddingQuery(false)}
      />
    );
  }

  return (
    <PagedModal
      trackingEventModalType="interleaving-form"
      header={
        duplicate
          ? "Duplicate Interleaving Experiment"
          : "Add Interleaving Experiment"
      }
      close={onClose}
      submit={submit}
      cta="Create"
      ctaEnabled={canCreate}
      disabledMessage="You don't have permission to create interleaving experiments in this project."
      closeCta="Cancel"
      size="lg"
      step={step}
      setStep={setStep}
      backButton
    >
      <Page display="Overview" validate={validateOverview}>
        <Box px="2">
          {projects.length > 0 && (
            <SelectField
              label="Project"
              value={project}
              onChange={(v) => form.setValue("project", v)}
              options={projects
                .filter((p) =>
                  permissionsUtil.canCreateInterleaving({ project: p.id }),
                )
                .map((p) => ({ value: p.id, label: p.name }))}
              initialOption="All Projects"
            />
          )}
          <Field
            label="Name"
            required
            value={form.watch("name")}
            onChange={(e) => {
              form.setValue("name", e.target.value);
              if (!keyEdited) {
                form.setValue("key", keyFromName(e.target.value));
              }
            }}
          />
          <Field
            label="Key"
            required
            value={form.watch("key")}
            onChange={(e) => {
              form.setValue("key", e.target.value);
              setKeyEdited(true);
            }}
            helpText="Passed to interleave() in your code. Can't be changed later."
          />
          <SelectOwner
            value={form.watch("owner")}
            onChange={(v) => form.setValue("owner", v)}
          />
          <TagsInput
            label="Tags"
            // Defaults to true, which would pull focus off Project/Name.
            autoFocus={false}
            value={form.watch("tags")}
            onChange={(tags) => form.setValue("tags", tags)}
          />
          <SelectField
            label="Hash attribute"
            value={form.watch("hashAttribute")}
            onChange={(v) => form.setValue("hashAttribute", v)}
            options={hashAttributes.map((a) => ({ value: a, label: a }))}
            createable
            helpText="Decides which users are interleaved."
          />
          <EnvironmentSelect
            environmentSettings={environmentSettings}
            environments={environments}
            project={project}
            canEnableEnvironment={canEnableEnvironment}
            setValue={(env, enabled) =>
              setEnvironmentSettings((prev) => ({
                ...prev,
                [env.id]: { ...prev[env.id], enabled },
              }))
            }
          />
        </Box>
      </Page>
      <Page display="Analysis">
        <Box px="2">
          <InterleavingAnalysisFields
            value={analysis}
            setValue={setAnalysis}
            project={project}
            onAddExposureQuery={() => setAddingQuery(true)}
          />
        </Box>
      </Page>
    </PagedModal>
  );
}
