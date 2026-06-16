import { FC, useEffect } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/router";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { getEqualWeights } from "shared/experiments";
import { isProjectListValidForProject } from "shared/util";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import { HoldoutSelect } from "@/components/Holdout/HoldoutSelect";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import {
  AttributeOptionWithTooltip,
  type AttributeOptionForTooltip,
} from "@/components/Features/AttributeOptionTooltip";
import HelperText from "@/ui/HelperText";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import { useWatching } from "@/services/WatchProvider";
import { convertTemplateToExperiment } from "@/services/experiments";
import { useAttributeSchema } from "@/services/features";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useTemplates } from "@/hooks/useTemplates";
import { useHoldouts } from "@/hooks/useHoldouts";
import { getDefaultVariations } from "@/components/Experiment/NewExperimentForm";

export type SimpleNewExperimentFormProps = {
  onClose?: () => void;
  source: string;
  onSwitchToLegacy?: () => void;
};

const SimpleNewExperimentForm: FC<SimpleNewExperimentFormProps> = ({
  onClose,
  source,
  onSwitchToLegacy,
}) => {
  const router = useRouter();
  const { apiCall } = useAuth();
  const { project: ctxProject, projects } = useDefinitions();
  const { hasCommercialFeature } = useUser();
  const settings = useOrgSettings();
  const permissionsUtil = usePermissionsUtil();
  const { refreshWatching } = useWatching();
  const {
    templates: allTemplates,
    templatesMap,
    mutateTemplates: refreshTemplates,
  } = useTemplates();
  const { experimentsMap, holdoutsMap } = useHoldouts();

  const initialProject = ctxProject || "";

  // Compute the initial hash attribute default from the active project's schema
  const initialAttributeSchema = useAttributeSchema(false, initialProject);
  const initialHashAttributes = initialAttributeSchema
    .filter((a) => a.hashAttribute)
    .map((a) => a.property);
  const initialHashAttribute = initialHashAttributes.includes("id")
    ? "id"
    : initialHashAttributes[0] || "id";

  const form = useForm<Partial<ExperimentInterfaceStringDates>>({
    defaultValues: {
      project: initialProject,
      name: "",
      hypothesis: "",
      hashAttribute: initialHashAttribute,
      templateId: "",
      holdoutId: undefined,
    },
  });

  const selectedProject = form.watch("project") ?? "";

  // Re-scope the live options to the selected project
  const attributeSchema = useAttributeSchema(false, selectedProject);
  const hashAttributes = attributeSchema
    .filter((a) => a.hashAttribute)
    .map((a) => a.property);
  const hasHashAttributes = hashAttributes.length > 0;
  const defaultHashAttribute = hashAttributes.includes("id")
    ? "id"
    : hashAttributes[0] || "id";

  const availableProjects = projects
    .slice()
    .sort((a, b) => (a.name > b.name ? 1 : -1))
    .filter((p) => permissionsUtil.canViewExperimentModal(p.id))
    .map((p) => ({ value: p.id, label: p.name }));

  const availableTemplates = allTemplates
    .slice()
    .sort((a, b) =>
      a.templateMetadata.name > b.templateMetadata.name ? 1 : -1,
    )
    .filter((t) =>
      isProjectListValidForProject(
        t.project ? [t.project] : [],
        selectedProject,
      ),
    )
    .map((t) => ({ value: t.id, label: t.templateMetadata.name }));

  const templateRequired =
    hasCommercialFeature("templates") &&
    settings.requireExperimentTemplates &&
    availableTemplates.length >= 1;

  const allowAllProjects = permissionsUtil.canViewExperimentModal();
  const hasProjectPermission = selectedProject
    ? permissionsUtil.canViewExperimentModal(selectedProject)
    : allowAllProjects;

  // When the project changes, drop any selection that's no longer valid there
  useEffect(() => {
    const templateId = form.getValues("templateId");
    if (templateId && !availableTemplates.some((t) => t.value === templateId)) {
      form.setValue("templateId", "");
    }
    const hashAttribute = form.getValues("hashAttribute");
    const validAttributes = attributeSchema
      .filter((s) => !hasHashAttributes || s.hashAttribute)
      .map((s) => s.property);
    if (hashAttribute && !validAttributes.includes(hashAttribute)) {
      form.setValue("hashAttribute", defaultHashAttribute);
    }
  }, [selectedProject]); // eslint-disable-line react-hooks/exhaustive-deps

  // If a holdout is selected, force the hash attribute to match the holdout's
  const holdoutId = form.watch("holdoutId");
  const holdoutExperimentId = holdoutId
    ? holdoutsMap.get(holdoutId)?.experimentId
    : undefined;
  const holdoutHashAttribute = holdoutExperimentId
    ? experimentsMap.get(holdoutExperimentId)?.hashAttribute
    : undefined;
  useEffect(() => {
    if (holdoutId && holdoutHashAttribute) {
      form.setValue("hashAttribute", holdoutHashAttribute);
    }
  }, [holdoutId, holdoutHashAttribute]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSubmit = form.handleSubmit(async (rawValue) => {
    const name = (rawValue.name || "").trim();
    if (name.length < 1) {
      throw new Error("Name must not be empty");
    }
    if (templateRequired && !rawValue.templateId) {
      throw new Error("You must select a template");
    }

    // Seed the experiment with sensible defaults so the overview page renders
    // properly; stakeholders fill in datasource/metrics/targeting later.
    let data: Partial<ExperimentInterfaceStringDates>;
    const template = rawValue.templateId
      ? templatesMap.get(rawValue.templateId)
      : undefined;

    if (template) {
      const templateAsExperiment = convertTemplateToExperiment(template);
      // skipPartialData is stored as a boolean on templates but the experiment
      // expects a "strict" | "loose" enum (mirrors NewExperimentForm).
      if (templateAsExperiment.skipPartialData === true) {
        // @ts-expect-error Mangled types
        templateAsExperiment.skipPartialData = "strict";
      } else if (templateAsExperiment.skipPartialData === false) {
        // @ts-expect-error Mangled types
        templateAsExperiment.skipPartialData = "loose";
      }
      data = templateAsExperiment;
    } else {
      const variations = getDefaultVariations(2);
      data = {
        variations,
        phases: [
          {
            coverage: 1,
            dateStarted: new Date().toISOString().substring(0, 16),
            dateEnded: "",
            name: "Main",
            reason: "",
            condition: "",
            variationWeights: getEqualWeights(variations.length),
            variations: variations.map((v) => ({
              id: v.id,
              status: "active" as const,
            })),
          },
        ],
      };
    }

    // Overlay the simple-flow fields
    data = {
      ...data,
      type: "standard",
      status: "draft",
      project: rawValue.project || "",
      name,
      hypothesis: rawValue.hypothesis || "",
      hashAttribute: rawValue.hashAttribute || "id",
      templateId: rawValue.templateId || "",
      holdoutId: rawValue.holdoutId || undefined,
      // Leave trackingKey empty — the back-end derives a unique key from the name
      trackingKey: "",
    };

    // A draft has no end date; ensure the start date is a proper UTC timestamp
    if (data.phases?.[0]) {
      data.phases[0].dateEnded = "";
      if (
        data.phases[0].dateStarted &&
        !data.phases[0].dateStarted.match(/Z$/)
      ) {
        data.phases[0].dateStarted += ":00Z";
      }
    }

    const res = await apiCall<
      | { experiment: ExperimentInterfaceStringDates }
      | { duplicateTrackingKey: true; existingId: string }
    >("/experiments", {
      method: "POST",
      body: JSON.stringify(data),
    });

    if ("duplicateTrackingKey" in res) {
      throw new Error(
        "An experiment with that tracking key already exists. Please try a different name.",
      );
    }

    track("Create Experiment", {
      source,
      numVariations: data.variations?.length || 0,
      createdFromTemplate: !!data.templateId,
    });
    refreshWatching();
    if (data.templateId) refreshTemplates();

    router.push(`/experiment/${res.experiment.id}`);
  });

  return (
    <ModalStandard
      open
      header="Create Experiment"
      cta="Create"
      size="lg"
      ctaEnabled={hasProjectPermission}
      submit={onSubmit}
      close={() => onClose?.()}
      trackingEventModalType="simple-new-experiment-create"
      trackingEventModalSource={source}
      headerAction={
        onSwitchToLegacy ? (
          <Link onClick={onSwitchToLegacy} color="gray">
            Switch to old experience
          </Link>
        ) : undefined
      }
    >
      <Field
        label="Experiment Name"
        required
        minLength={2}
        {...form.register("name")}
      />

      {availableTemplates.length >= 1 && (
        <SelectField
          label={
            <PremiumTooltip commercialFeature="templates">
              Template
            </PremiumTooltip>
          }
          value={form.watch("templateId") ?? ""}
          onChange={(t) => {
            form.setValue("templateId", t);
            if (!t) {
              // Clearing the template — restore form defaults
              form.setValue("hypothesis", "");
              form.setValue("hashAttribute", defaultHashAttribute);
              return;
            }
            const template = templatesMap.get(t);
            if (!template) return;
            const templateAsExperiment = convertTemplateToExperiment(template);
            if (templateAsExperiment.hypothesis) {
              form.setValue("hypothesis", templateAsExperiment.hypothesis);
            }
            if (templateAsExperiment.hashAttribute) {
              form.setValue(
                "hashAttribute",
                templateAsExperiment.hashAttribute,
              );
            }
          }}
          name="template"
          initialOption="None"
          options={availableTemplates}
          helpText={
            templateRequired
              ? "Your organization requires experiments to be created from a template"
              : undefined
          }
          disabled={!hasCommercialFeature("templates")}
          required={templateRequired}
        />
      )}

      {projects.length >= 1 && (
        <SelectField
          label="Project"
          value={form.watch("project") ?? ""}
          onChange={(p) => form.setValue("project", p)}
          name="project"
          initialOption={allowAllProjects ? "All Projects" : undefined}
          options={availableProjects}
        />
      )}

      {!hasProjectPermission && (
        <Callout status="error" mb="3">
          You don&apos;t have permission to create experiments in this project.
        </Callout>
      )}

      <HoldoutSelect
        selectedProject={selectedProject}
        selectedHoldoutId={form.watch("holdoutId")}
        setHoldout={(holdoutId) => form.setValue("holdoutId", holdoutId)}
        formType="experiment"
      />

      <Field
        label="Hypothesis"
        textarea
        minRows={2}
        placeholder="e.g. Making the signup button bigger will increase clicks and ultimately improve revenue"
        {...form.register("hypothesis")}
      />

      <SelectField
        label="Hash Attribute"
        value={form.watch("hashAttribute") ?? ""}
        helpText="Will be hashed together with the Tracking Key to determine which variation to assign"
        onChange={(v) => form.setValue("hashAttribute", v)}
        options={attributeSchema
          .filter((s) => !hasHashAttributes || s.hashAttribute)
          .map((s) => ({
            label: s.property,
            value: s.property,
            description: s.description,
            tags: s.tags,
            datatype: s.datatype,
            hashAttribute: s.hashAttribute,
          }))}
        formatOptionLabel={(o, meta) => (
          <AttributeOptionWithTooltip
            option={o as AttributeOptionForTooltip}
            context={meta.context}
          >
            {o.label}
          </AttributeOptionWithTooltip>
        )}
      />
      {!!holdoutHashAttribute &&
        form.watch("hashAttribute") !== holdoutHashAttribute && (
          <HelperText status="warning" size="sm" mb="2">
            The hash attribute of this experiment does not match the hash
            attribute of the holdout this experiment will belong to.
          </HelperText>
        )}
    </ModalStandard>
  );
};

export default SimpleNewExperimentForm;
