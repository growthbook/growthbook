import { useMemo, useState } from "react";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { PiCaretDown, PiCaretRight } from "react-icons/pi";
import {
  ExperimentIdeaInformedBy,
  ExperimentIdeaStringDates,
  LearningWithCanManage,
} from "shared/validators";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import TagsInput from "@/components/Tags/TagsInput";
import CustomFieldInput from "@/components/CustomFields/CustomFieldInput";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import MultiSelectField from "@/ui/MultiSelectField";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import Owner from "@/components/Avatar/Owner";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useReconciledCustomFields } from "@/hooks/useReconciledCustomFields";
import { useExperiments } from "@/hooks/useExperiments";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useApi from "@/hooks/useApi";
import { useExperimentIdeaStages } from "./useExperimentIdeas";

const encodeRef = (r: ExperimentIdeaInformedBy) => `${r.kind}:${r.id}`;
const decodeRef = (v: string): ExperimentIdeaInformedBy => {
  const [kind, ...rest] = v.split(":");
  return {
    kind: kind === "learning" ? "learning" : "experiment",
    id: rest.join(":"),
  };
};

export default function IdeaFormModal({
  idea,
  defaultStage,
  close,
  onSaved,
}: {
  // Undefined => create
  idea?: ExperimentIdeaStringDates;
  defaultStage?: string;
  close: () => void;
  onSaved: (id: string) => void;
}) {
  const isNew = !idea;
  const { apiCall } = useAuth();
  const { userId, users, hasCommercialFeature } = useUser();
  const {
    projects,
    project: currentProject,
    metrics,
    factMetrics,
  } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const { stages, defaultStageId } = useExperimentIdeaStages();
  const hasLearnings = hasCommercialFeature("learnings");

  const [title, setTitle] = useState(idea?.title ?? "");
  const [description, setDescription] = useState(idea?.description ?? "");
  const [hypothesis, setHypothesis] = useState(idea?.hypothesis ?? "");
  const [expectedOutcome, setExpectedOutcome] = useState(
    idea?.expectedOutcome ?? "",
  );
  const [rationale, setRationale] = useState(idea?.rationale ?? "");
  const [productArea, setProductArea] = useState(idea?.productArea ?? "");
  const [project, setProject] = useState(idea?.project ?? currentProject ?? "");
  const [stage, setStage] = useState(
    idea?.stage ?? defaultStage ?? defaultStageId,
  );
  const [owner, setOwner] = useState(idea?.owner ?? "");
  const [tags, setTags] = useState<string[]>(idea?.tags ?? []);
  const [metricIds, setMetricIds] = useState<string[]>(idea?.metricIds ?? []);
  const [informedBy, setInformedBy] = useState<string[]>(
    (idea?.informedBy ?? []).map(encodeRef),
  );
  const [customFields, setCustomFields] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(idea?.customFields ?? {}).map(([k, v]) => [
        k,
        typeof v === "string" ? v : JSON.stringify(v),
      ]),
    ),
  );
  const [showMore, setShowMore] = useState(!isNew);

  const { availableFields, value: customFieldValues } =
    useReconciledCustomFields({
      section: "experiment-idea",
      project: project || undefined,
      value: customFields,
      setValue: setCustomFields,
    });
  const requiredFields = availableFields.filter((f) => f.required);
  const optionalFields = availableFields.filter((f) => !f.required);

  const { experiments } = useExperiments("", true);
  const { data: learningsData } = useApi<{
    learnings: LearningWithCanManage[];
  }>("/learnings", { shouldRun: () => hasLearnings && showMore });

  const priorWorkOptions = useMemo(() => {
    const groups: {
      label: string;
      options: { label: string; value: string }[];
    }[] = [];
    if (hasLearnings && learningsData?.learnings.length) {
      groups.push({
        label: "Learnings",
        options: learningsData.learnings.map((l) => ({
          label: l.title,
          value: encodeRef({ kind: "learning", id: l.id }),
        })),
      });
    }
    groups.push({
      label: "Experiments",
      options: experiments.map((e) => ({
        label: e.name,
        value: encodeRef({ kind: "experiment", id: e.id }),
      })),
    });
    return groups;
  }, [experiments, learningsData, hasLearnings]);

  const projectOptions = [
    { label: "All Projects", value: "" },
    ...projects
      .filter(
        (p) =>
          p.id === idea?.project ||
          permissionsUtil.canManageExperimentIdea({ project: p.id }),
      )
      .map((p) => ({ label: p.name, value: p.id })),
  ];

  const missingRequired = requiredFields.some(
    (f) => f.type !== "boolean" && !customFieldValues[f.id],
  );

  return (
    <ModalStandard
      open={true}
      close={close}
      size="lg"
      header={isNew ? "New idea" : "Edit idea"}
      cta={isNew ? "Save idea" : "Save"}
      ctaEnabled={title.trim().length > 0 && !missingRequired}
      trackingEventModalType={
        isNew ? "new-experiment-idea" : "edit-experiment-idea"
      }
      submit={async () => {
        const body = {
          title: title.trim(),
          description,
          project,
          stage,
          tags,
          metricIds,
          informedBy: informedBy.map(decodeRef),
          customFields: customFieldValues,
          ...(isNew
            ? {}
            : { hypothesis, expectedOutcome, rationale, productArea, owner }),
        };
        const res = await apiCall<{ idea: { id: string } }>(
          isNew ? "/experiment-ideas" : `/experiment-ideas/${idea.id}`,
          { method: isNew ? "POST" : "PUT", body: JSON.stringify(body) },
        );
        onSaved(res.idea.id);
      }}
    >
      <Box mb="4">
        <Field
          label="Title"
          markRequired
          placeholder="e.g. Show delivery estimate on the product page"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
          maxLength={200}
        />
      </Box>
      <Box mb="4">
        <Field
          label="Description"
          textarea
          minRows={3}
          placeholder="What's the opportunity, and what made you think of it?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Box>
      {!isNew && (
        <>
          <Box mb="4">
            <Field
              label="Hypothesis"
              textarea
              minRows={2}
              value={hypothesis}
              onChange={(e) => setHypothesis(e.target.value)}
            />
          </Box>
          <Grid columns={{ initial: "1", sm: "2" }} gap="4" mb="4">
            <Field
              label="Expected outcome"
              textarea
              minRows={2}
              value={expectedOutcome}
              onChange={(e) => setExpectedOutcome(e.target.value)}
            />
            <Field
              label="Rationale"
              textarea
              minRows={2}
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
            />
          </Grid>
        </>
      )}
      {requiredFields.length > 0 && (
        <Box mb="4">
          <CustomFieldInput
            fields={requiredFields}
            value={customFieldValues}
            onChange={(v) => setCustomFields({ ...customFieldValues, ...v })}
          />
        </Box>
      )}
      <Grid columns={{ initial: "1", sm: "2" }} gap="4" mb="4">
        <SelectField
          label="Project"
          value={project}
          options={projectOptions}
          onChange={setProject}
          sort={false}
        />
        <SelectField
          label="Stage"
          value={stage}
          options={stages.map((s) => ({ label: s.label, value: s.id }))}
          onChange={setStage}
          sort={false}
        />
      </Grid>
      <Box mb="3">
        <Link onClick={() => setShowMore(!showMore)} weight="medium">
          <Flex align="center" gap="1" display="inline-flex">
            {showMore ? <PiCaretDown /> : <PiCaretRight />}
            {isNew
              ? `Add tags, metrics, prior ${hasLearnings ? "learnings" : "work"}`
              : "Ownership, tags, metrics and prior work"}
          </Flex>
        </Link>
      </Box>
      {showMore && (
        <>
          <Grid columns={{ initial: "1", sm: "2" }} gap="4" mb="4">
            {isNew ? (
              <Box>
                <Text as="label" weight="medium">
                  Owner
                </Text>
                <Box mt="1">
                  <Owner ownerId={userId} />
                </Box>
              </Box>
            ) : (
              <SelectField
                label="Owner"
                value={owner}
                options={[...users.values()].map((u) => ({
                  label: u.name || u.email,
                  value: u.id,
                }))}
                onChange={setOwner}
                initialOption="Unassigned"
              />
            )}
            {!isNew && (
              <Field
                label="Product area"
                value={productArea}
                onChange={(e) => setProductArea(e.target.value)}
              />
            )}
          </Grid>
          <Box mb="4">
            <label>Tags</label>
            <TagsInput value={tags} onChange={setTags} autoFocus={false} />
          </Box>
          <Box mb="4">
            <MultiSelectField
              label="Metrics of interest"
              placeholder="Search metrics..."
              value={metricIds}
              options={[...factMetrics, ...metrics].map((m) => ({
                label: m.name,
                value: m.id,
              }))}
              onChange={setMetricIds}
            />
          </Box>
          <Box mb="4">
            <MultiSelectField
              label="Prior work"
              placeholder={`Search ${hasLearnings ? "Learnings and " : ""}experiments...`}
              value={informedBy}
              options={priorWorkOptions}
              onChange={setInformedBy}
            />
          </Box>
          {optionalFields.length > 0 && (
            <Box mb="4">
              <CustomFieldInput
                fields={optionalFields}
                value={customFieldValues}
                onChange={(v) =>
                  setCustomFields({ ...customFieldValues, ...v })
                }
              />
            </Box>
          )}
        </>
      )}
    </ModalStandard>
  );
}
