import { useRouter } from "next/router";
import React, { FC, useEffect, useState } from "react";
import { ExperimentTemplateInterface } from "shared/types/experiment";
import { FormProvider, useForm } from "react-hook-form";
import { validateAndFixCondition } from "shared/util";
import { isEmpty, kebabCase } from "lodash";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAttributeSchema, useEnvironments } from "@/services/features";
import { useAuth } from "@/services/auth";
import { validateSavedGroupTargeting } from "@/components/Features/SavedGroupTargetingField";
import track from "@/services/track";
import SelectField, { SingleValue } from "@/components/Forms/SelectField";
import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useIncrementer } from "@/hooks/useIncrementer";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import PagedModal from "@/components/Modal/PagedModal";
import Page from "@/components/Modal/Page";
import Field from "@/components/Forms/Field";
import TagsInput from "@/components/Tags/TagsInput";
import ExperimentRefNewFields from "@/components/Features/RuleModal/ExperimentRefNewFields";
import { useTemplates } from "@/hooks/useTemplates";
import {
  filterCustomFieldsForSectionAndProject,
  useCustomFields,
} from "@/hooks/useCustomFields";
import CustomFieldInput from "@/components/CustomFields/CustomFieldInput";
import { useUser } from "@/services/UserContext";

type Props = {
  initialValue?: Partial<ExperimentTemplateInterface>;
  duplicate?: boolean;
  source: string;
  msg?: string;
  onClose?: () => void;
  onCreate?: (id: string) => void;
  isNewTemplate?: boolean;
};

interface TemplateForm
  extends Omit<ExperimentTemplateInterface, "skipPartialData"> {
  skipPartialData: string;
}

const TemplateForm: FC<Props> = ({
  initialValue = {
    type: "standard",
  },
  onClose,
  onCreate = null,
  duplicate,
  source,
  msg,
  isNewTemplate,
}) => {
  const router = useRouter();
  const [step, setStep] = useState(0);

  const { getDatasourceById, refreshTags, project, projects } =
    useDefinitions();
  const { hasCommercialFeature } = useUser();

  const environments = useEnvironments();
  const envs = environments.map((e) => e.id);

  const [prerequisiteTargetingSdkIssues, setPrerequisiteTargetingSdkIssues] =
    useState(false);
  const canSubmit = !prerequisiteTargetingSdkIssues;

  const { useStickyBucketing, statsEngine: orgStatsEngine } = useOrgSettings();
  const permissionsUtils = usePermissionsUtil();
  const { mutateTemplates } = useTemplates();

  const [conditionKey, forceConditionRender] = useIncrementer();

  const attributeSchema = useAttributeSchema(false, project);
  const hashAttributes =
    attributeSchema?.filter((a) => a.hashAttribute)?.map((a) => a.property) ||
    [];
  const hashAttribute = hashAttributes.includes("id")
    ? "id"
    : hashAttributes[0] || "id";

  const orgStickyBucketing = !!useStickyBucketing;

  const form = useForm<TemplateForm>({
    defaultValues: {
      project: initialValue?.project || project,
      templateMetadata: {
        name: duplicate
          ? `Copy of ${initialValue?.templateMetadata?.name}`
          : initialValue?.templateMetadata?.name || "",
        description: initialValue?.templateMetadata?.description || "",
      },
      type: initialValue?.type ?? "standard",
      hypothesis: initialValue?.hypothesis || "",
      description: initialValue?.description || "",
      tags: initialValue?.tags || [],
      customFields: initialValue?.customFields || {},
      datasource: initialValue?.datasource || "",
      exposureQueryId: initialValue?.exposureQueryId || "",
      activationMetric: initialValue?.activationMetric || "",
      hashAttribute: initialValue?.hashAttribute || hashAttribute,
      disableStickyBucketing: initialValue?.disableStickyBucketing ?? false,
      goalMetrics: initialValue?.goalMetrics || [],
      secondaryMetrics: initialValue?.secondaryMetrics || [],
      guardrailMetrics: initialValue?.guardrailMetrics || [],
      statsEngine: initialValue?.statsEngine || orgStatsEngine,
      skipPartialData: initialValue.skipPartialData ? "strict" : "loose",
      segment: initialValue.segment || "",
      targeting: {
        coverage: initialValue.targeting?.coverage || 1,
        savedGroups: initialValue.targeting?.savedGroups || [],
        prerequisites: initialValue.targeting?.prerequisites || [],
        condition: initialValue.targeting?.condition || "",
      },
      customMetricSlices: initialValue?.customMetricSlices || [],
      pinnedMetricSlices: initialValue?.pinnedMetricSlices || [],
    },
  });

  const customFields = filterCustomFieldsForSectionAndProject(
    useCustomFields(),
    "experiment",
    form.watch("project"),
  );

  const datasource = form.watch("datasource")
    ? getDatasourceById(form.watch("datasource") ?? "")
    : null;

  const { apiCall } = useAuth();

  const onSubmit = form.handleSubmit(async (rawValue) => {
    const value: ExperimentTemplateInterface = {
      ...rawValue,
      templateMetadata: {
        ...rawValue.templateMetadata,
        name: rawValue.templateMetadata.name?.trim(),
      },
      skipPartialData: rawValue.skipPartialData === "strict",
    };

    // Make sure there's an experiment name
    if ((value.templateMetadata?.name?.length ?? 0) < 1) {
      setStep(0);
      throw new Error("Template Name must not be empty");
    }

    // Turn phase dates into proper UTC timestamps
    validateSavedGroupTargeting(value.targeting?.savedGroups);

    validateAndFixCondition(value.targeting?.condition, (condition) => {
      form.setValue("targeting.condition", condition);
      forceConditionRender();
    });

    if (prerequisiteTargetingSdkIssues) {
      throw new Error("Prerequisite targeting issues must be resolved");
    }

    const body = JSON.stringify(value);

    const res =
      initialValue.id && !duplicate
        ? await apiCall<{ template: ExperimentTemplateInterface }>(
            `/templates/${initialValue.id}`,
            {
              method: "PUT",
              body,
            },
          )
        : await apiCall<{ template: ExperimentTemplateInterface }>(
            "/templates",
            {
              method: "POST",
              body,
            },
          );

    track("Create Experiment Template", {
      source,
      numTags: value.tags?.length || 0,
      numMetrics:
        (value.goalMetrics?.length || 0) +
        (value.secondaryMetrics?.length || 0),
    });

    value.tags && refreshTags(value.tags);
    mutateTemplates();
    if (onCreate) {
      onCreate(res.template.id);
    } else if (isEmpty(initialValue) || isNewTemplate) {
      router.push(`/experiments#templates`);
    }
  });

  const availableProjects: SingleValue[] = projects
    .slice()
    .sort((a, b) => (a.name > b.name ? 1 : -1))
    .filter((p) => permissionsUtils.canViewExperimentModal(p.id))
    .map((p) => ({ value: p.id, label: p.name }));

  const allowAllProjects = permissionsUtils.canViewExperimentModal();

  const exposureQueryId = form.getValues("exposureQueryId");

  const { currentProjectIsDemo } = useDemoDataSourceProject();

  useEffect(() => {
    const exposureQueries = datasource?.settings?.queries?.exposure || [];

    if (!exposureQueries.find((q) => q.id === exposureQueryId)) {
      form.setValue("exposureQueryId", exposureQueries?.[0]?.id ?? "");
    }
  }, [form, exposureQueryId, datasource?.settings?.queries?.exposure]);

  let header = isNewTemplate
    ? "Create Experiment Template"
    : "Edit Experiment Template";
  if (duplicate) {
    header = "Duplicate Experiment Template";
  }
  const trackingEventModalType = kebabCase(header);

  const nameFieldHandlers = form.register("templateMetadata.name", {
    setValueAs: (s) => s?.trim(),
  });

  return (
    <FormProvider {...form}>
      <PagedModal
        trackingEventModalType={trackingEventModalType}
        trackingEventModalSource={source}
        header={header}
        close={onClose}
        submit={onSubmit}
        cta={"Save"}
        ctaEnabled={canSubmit}
        closeCta="Cancel"
        size="lg"
        step={step}
        setStep={setStep}
        backButton={true}
        bodyClassName="px-4"
        navFill
      >
        <Page display="Overview">
          <div>
            {msg && <div className="alert alert-info">{msg}</div>}

            {currentProjectIsDemo && (
              <div className="alert alert-warning">
                You are creating a template under the demo datasource project.
                This template will be deleted when the demo datasource project
                is deleted.
              </div>
            )}

            <h4 className="mb-3">Template Details</h4>

            <Field
              label="Template Name"
              required
              minLength={2}
              {...nameFieldHandlers}
            />

            {projects.length >= 1 && (
              <div className="form-group">
                <label>Available in Project</label>
                <SelectField
                  value={form.watch("project") ?? ""}
                  onChange={(p) => {
                    form.setValue("project", p);
                  }}
                  name="project"
                  initialOption={allowAllProjects ? "All Projects" : undefined}
                  options={availableProjects}
                />
              </div>
            )}

            <Field
              label="Template Description"
              textarea
              minRows={1}
              {...form.register("templateMetadata.description")}
              placeholder={"Short human-readable description of the template"}
            />

            <hr />

            <h4 className="my-3">Experiment Details</h4>

            <Field
              label="Experiment Hypothesis"
              textarea
              minRows={1}
              placeholder="e.g. Making the signup button bigger will increase clicks and ultimately improve revenue"
              {...form.register("hypothesis")}
            />

            <Field
              label="Experiment Description"
              textarea
              minRows={1}
              {...form.register("description")}
              placeholder={"Short human-readable description of the experiment"}
            />

            <div className="form-group">
              <label>Experiment Tags</label>
              <TagsInput
                value={form.watch("tags") ?? []}
                onChange={(tags) => form.setValue("tags", tags)}
              />
            </div>

            {hasCommercialFeature("custom-metadata") &&
              !!customFields?.length && (
                <div className="form-group">
                  <CustomFieldInput
                    customFields={customFields}
                    setCustomFields={(value) => {
                      form.setValue("customFields", value);
                    }}
                    currentCustomFields={form.watch("customFields") || {}}
                    section={"experiment"}
                    project={form.watch("project")}
                  />
                </div>
              )}
          </div>
        </Page>

        {["Overview", "Traffic", "Targeting", "Metrics"].map((p, i) => {
          // skip, custom overview page above
          if (i === 0) return null;
          return (
            <Page display={p} key={i}>
              <ExperimentRefNewFields
                step={i}
                source="experiment"
                project={form.watch("project")}
                environments={envs}
                noSchedule={true}
                prerequisiteValue={form.watch("targeting.prerequisites") || []}
                setPrerequisiteValue={(prerequisites) =>
                  form.setValue("targeting.prerequisites", prerequisites)
                }
                setPrerequisiteTargetingSdkIssues={
                  setPrerequisiteTargetingSdkIssues
                }
                savedGroupValue={form.watch("targeting.savedGroups") || []}
                setSavedGroupValue={(savedGroups) =>
                  form.setValue("targeting.savedGroups", savedGroups)
                }
                defaultConditionValue={form.watch("targeting.condition") || ""}
                setConditionValue={(value) =>
                  form.setValue("targeting.condition", value)
                }
                conditionKey={conditionKey}
                namespaceFormPrefix={"targeting."}
                coverage={form.watch("targeting.coverage")}
                setCoverage={(coverage) =>
                  form.setValue("targeting.coverage", coverage)
                }
                variationValuesAsIds={true}
                hideVariationIds={true}
                orgStickyBucketing={orgStickyBucketing}
                isTemplate
              />
            </Page>
          );
        })}
      </PagedModal>
    </FormProvider>
  );
};

export default TemplateForm;
