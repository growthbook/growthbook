import { useState } from "react";
import { useRouter } from "next/router";
import { interleavingEndpoints } from "shared/api-endpoints";
import { useRestApiCall } from "@/services/restApi";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAttributeSchema, useEnvironments } from "@/services/features";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import PagedModal from "@/components/Modal/PagedModal";
import Page from "@/components/Modal/Page";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import TagsInput from "@/components/Tags/TagsInput";
import EnvironmentSelect from "@/components/Features/FeatureModal/EnvironmentSelect";
import InterleavingVariationsInput, {
  getRankersError,
  InterleavingRankers,
} from "@/components/Interleaving/InterleavingVariationsInput";
import InterleavingAnalysisFields, {
  getAnalysisError,
  InterleavingAnalysisValue,
} from "@/components/Interleaving/InterleavingAnalysisFields";
import { getMetricsError } from "@/components/Interleaving/InterleavingMetricsInput";

const DEFAULT_RANKERS: InterleavingRankers = [
  { key: "control", name: "Control", config: "{}" },
  { key: "treatment", name: "Treatment", config: "{}" },
];

function keyFromName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-.:|]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function assertNoError(error: string | null) {
  if (error) throw new Error(error);
}

export default function InterleavingForm({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const restApiCall = useRestApiCall();
  const permissionsUtil = usePermissionsUtil();
  const { project: currentProject, projects, refreshTags } = useDefinitions();

  const [step, setStep] = useState(0);
  const [project, setProject] = useState(currentProject);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyEdited, setKeyEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [rankers, setRankers] = useState<InterleavingRankers>(DEFAULT_RANKERS);
  const [analysis, setAnalysis] = useState<InterleavingAnalysisValue>({
    datasource: "",
    interleavingExposureQueryId: "",
    userIdType: "",
    metrics: [],
  });

  const hashAttributes = useAttributeSchema(false, project)
    .filter((a) => a.hashAttribute)
    .map((a) => a.property);
  const [hashAttribute, setHashAttribute] = useState(
    hashAttributes.includes("id") ? "id" : (hashAttributes[0] ?? "id"),
  );

  const canCreate = permissionsUtil.canCreateInterleaving({ project });

  const environments = useEnvironments();
  const canEnableEnvironment = (envId: string) =>
    permissionsUtil.canRunInterleaving({ project }, [envId]);
  const [environmentSettings, setEnvironmentSettings] = useState(() =>
    Object.fromEntries(
      environments.map((e) => [
        e.id,
        { enabled: (e.defaultState ?? true) && canEnableEnvironment(e.id) },
      ]),
    ),
  );

  const validateOverview = async () => {
    if (!name.trim()) throw new Error("Name is required");
    if (!key) throw new Error("Key is required");
    assertNoError(getRankersError(rankers));
  };

  const submit = async () => {
    await validateOverview();
    assertNoError(getAnalysisError(analysis));
    assertNoError(getMetricsError(analysis.metrics));
    const res = await restApiCall(interleavingEndpoints.createInterleaving, {
      body: {
        name: name.trim(),
        key,
        description: description || undefined,
        project: project || undefined,
        tags,
        hashAttribute,
        variations: rankers,
        environmentSettings: Object.fromEntries(
          Object.entries(environmentSettings).map(([id, s]) => [
            id,
            { ...s, enabled: s.enabled && canEnableEnvironment(id) },
          ]),
        ),
        ...analysis,
      },
    });
    if (tags.length) await refreshTags(tags);
    router.push(`/interleaving/${res.interleaving.id}`);
  };

  return (
    <PagedModal
      trackingEventModalType="interleaving-form"
      header="Add Interleaving Experiment"
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
        <div className="px-2">
          {projects.length > 0 && (
            <SelectField
              label="Project"
              value={project}
              onChange={setProject}
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
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!keyEdited) setKey(keyFromName(e.target.value));
            }}
          />
          <Field
            label="Key"
            required
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setKeyEdited(true);
            }}
            helpText="Passed to interleave() in your code. Can't be changed later."
          />
          <Field
            label="Description"
            textarea
            minRows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="form-group">
            <label>Tags</label>
            <TagsInput value={tags} onChange={setTags} />
          </div>
          <SelectField
            label="Hash Attribute"
            value={hashAttribute}
            onChange={setHashAttribute}
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
          <InterleavingVariationsInput
            value={rankers}
            setValue={setRankers}
            hideConfig
          />
        </div>
      </Page>
      <Page display="Analysis">
        <div className="px-2">
          <InterleavingAnalysisFields
            value={analysis}
            setValue={setAnalysis}
            project={project}
          />
        </div>
      </Page>
    </PagedModal>
  );
}
