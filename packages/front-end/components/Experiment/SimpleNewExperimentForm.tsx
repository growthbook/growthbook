import { FC, useEffect, useId, useState } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/router";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  DataSourceInterfaceWithParams,
  ExposureQuery,
} from "shared/types/datasource";
import { getEqualWeights } from "shared/experiments";
import {
  resolveAnalysisIdentifierType,
  getExposureQueryIdentifierTypes,
  getManagedWarehouseExposureQueryIdForAttribute,
  isProjectListValidForProject,
} from "shared/util";
import { Box, Flex } from "@radix-ui/themes";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import { HoldoutSelect } from "@/components/Holdout/HoldoutSelect";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import {
  formatAttributeOptionLabel,
  toAttributeOption,
} from "@/components/Features/AttributeOptionTooltip";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";
import AIRichTextField from "@/components/Markdown/AIRichTextField";
import { useSuggestHypothesis } from "@/components/Experiment/useSuggestHypothesis";
import Link from "@/ui/Link";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  getExposureQueriesForAttribute,
  getExposureQueriesForProject,
  getDefaultIdentifierTypeForQuery,
  getHashAttributeIdentifierTypeMap,
} from "@/services/datasources";
import { useUser } from "@/services/UserContext";
import { useWatching } from "@/services/WatchProvider";
import { convertTemplateToExperiment } from "@/services/experiments";
import { useAttributeSchema } from "@/services/features";
import useOrgSettings from "@/hooks/useOrgSettings";
import useExperimentKeyFieldProps from "@/hooks/useExperimentKeyFieldProps";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useTemplates } from "@/hooks/useTemplates";
import { useHoldouts } from "@/hooks/useHoldouts";
import { useReconciledCustomFields } from "@/hooks/useReconciledCustomFields";
import CustomFieldInput from "@/components/CustomFields/CustomFieldInput";
import { getDefaultVariations } from "@/components/Experiment/NewExperimentForm";
import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import SDKCapabilityWarning from "@/components/Features/SDKCapabilityWarning";
import { allConnectionsSupportBucketingV2 } from "@/components/Experiment/HashVersionSelector";
import useSDKConnections from "@/hooks/useSDKConnections";

export type SimpleNewExperimentFormProps = {
  onClose?: () => void;
  source: string;
  onSwitchToLegacy?: () => void;
};

// Auto-select a datasource only when the choice is unambiguous, and never the
// sample/demo datasource.
export function getAutoDatasourceId({
  datasources,
  demoDataSourceId,
  defaultDataSource,
  project,
  templateDatasource,
}: {
  datasources: DataSourceInterfaceWithParams[];
  demoDataSourceId: string | null;
  defaultDataSource?: string;
  project: string;
  templateDatasource?: string;
}): string {
  const validDatasources = datasources.filter(
    (d) =>
      d.id !== demoDataSourceId &&
      isProjectListValidForProject(d.projects, project),
  );

  if (templateDatasource) {
    const templateDatasourceIsValid = validDatasources.some(
      (d) => d.id === templateDatasource,
    );
    if (templateDatasourceIsValid) return templateDatasource;
  }

  const defaultDatasource =
    defaultDataSource &&
    validDatasources.find((d) => d.id === defaultDataSource);
  if (defaultDatasource) return defaultDatasource.id;
  if (validDatasources.length === 1) return validDatasources[0].id;
  return "";
}

// Auto-select an experiment assignment query only when the choice is unambiguous.
export function getAutoExposureQueryId({
  datasource,
  hashAttribute,
  project,
  templateExposureQueryId,
}: {
  datasource?: DataSourceInterfaceWithParams;
  hashAttribute: string;
  project?: string;
  templateExposureQueryId?: string;
}): string {
  const dsSettings = datasource?.settings;
  const exposureQueries = getExposureQueriesForProject(
    dsSettings?.queries?.exposure || [],
    project,
    datasource?.projects,
  );

  if (templateExposureQueryId) {
    const templateExposureQueryIsValid = exposureQueries.some(
      (q) => q.id === templateExposureQueryId,
    );
    if (templateExposureQueryIsValid) return templateExposureQueryId;
  }

  if (exposureQueries.length === 1) return exposureQueries[0].id;

  // Managed warehouses don't populate userIdType.attributes links, so the generic
  // lookup below can't resolve the assignment query. Map the hash attribute to its
  // exposure query directly instead.
  if (datasource?.type === "growthbook_clickhouse") {
    const managedQueryId = getManagedWarehouseExposureQueryIdForAttribute({
      settings: datasource.settings,
      attribute: hashAttribute,
    });
    return exposureQueries.some((q) => q.id === managedQueryId)
      ? managedQueryId
      : "";
  }

  // A hash attribute can be linked to several identifier types, each with its
  // own query; only one linked query is unambiguous.
  const { matching } = getExposureQueriesForAttribute(
    dsSettings,
    hashAttribute,
    exposureQueries,
  );
  return matching.length === 1 ? matching[0].id : "";
}

// "id" when flagged, else the only flagged attribute; otherwise the form asks,
// starting from "id" only when none is flagged and the schema declares it.
export function defaultHashAttributeOf(
  schema: { property: string; hashAttribute?: boolean }[],
): string {
  const hashable = schema.filter((a) => a.hashAttribute).map((a) => a.property);
  if (hashable.length) {
    if (hashable.includes("id")) return "id";
    return hashable.length === 1 ? hashable[0] : "";
  }
  return !schema.length || schema.some((a) => a.property === "id") ? "id" : "";
}

/**
 * A template's assignment selection, kept when its query still declares the
 * identifier and otherwise moved to one that does, since a different
 * identifier would measure different units. "unavailable" when no query in
 * the Project's scope declares it, so the experiment is created without
 * assignment settings. Null when the template has no selection to honor.
 */
export function resolveTemplateAssignment({
  datasource,
  project,
  templateExposureQueryId,
  templateIdentifierType,
}: {
  datasource?: DataSourceInterfaceWithParams;
  project?: string;
  templateExposureQueryId?: string;
  templateIdentifierType?: string;
}):
  | { kind: "selected"; exposureQueryId: string; identifierType: string }
  | {
      kind: "unavailable";
      identifierType: string;
      /** Queries declare the identifier, but none in this Project's scope. */
      outOfScope: boolean;
    }
  | null {
  const queries = datasource?.settings?.queries?.exposure ?? [];
  const templateQuery = queries.find((q) => q.id === templateExposureQueryId);
  if (!templateQuery) return null;
  const identifierType = resolveAnalysisIdentifierType(
    templateQuery,
    templateIdentifierType,
  );
  if (!identifierType) return null;
  const declaresIt = (q: ExposureQuery) =>
    getExposureQueryIdentifierTypes(q).includes(identifierType);
  const query = getExposureQueriesForProject(
    [templateQuery, ...queries],
    project,
    datasource?.projects,
  ).find(declaresIt);
  return query
    ? { kind: "selected", exposureQueryId: query.id, identifierType }
    : {
        kind: "unavailable",
        identifierType,
        outOfScope: queries.some(declaresIt),
      };
}

function getAutoExposureQueryIdentifierType({
  datasource,
  hashAttribute,
  exposureQueryId,
  templateIdentifierType,
}: {
  datasource?: DataSourceInterfaceWithParams;
  hashAttribute: string;
  exposureQueryId: string;
  templateIdentifierType?: string;
}): string | undefined {
  const exposureQuery = datasource?.settings?.queries?.exposure?.find(
    (q) => q.id === exposureQueryId,
  );
  if (!exposureQuery) return undefined;

  const declared = getExposureQueryIdentifierTypes(exposureQuery);
  if (templateIdentifierType && declared.includes(templateIdentifierType)) {
    return templateIdentifierType;
  }
  const linked =
    getHashAttributeIdentifierTypeMap(datasource?.settings?.userIdTypes).get(
      hashAttribute,
    ) ?? [];
  return (
    declared.find((identifierType) => linked.includes(identifierType)) ??
    getDefaultIdentifierTypeForQuery(exposureQuery)
  );
}

const SimpleNewExperimentForm: FC<SimpleNewExperimentFormProps> = ({
  onClose,
  source,
  onSwitchToLegacy,
}) => {
  const router = useRouter();
  const { apiCall } = useAuth();
  const {
    project: ctxProject,
    projects,
    datasources,
    getDatasourceById,
  } = useDefinitions();
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
  const { demoDataSourceId, projectId: demoProjectId } =
    useDemoDataSourceProject();
  const { data: sdkConnectionsData, isLoading: sdkConnectionsLoading } =
    useSDKConnections();

  const showSwitchToOldExpCreate = useFeatureIsOn(
    "show-switch-to-old-exp-create",
  );

  const initialProject = ctxProject || "";

  const initialAttributeSchema = useAttributeSchema(false, initialProject);
  const initialHashAttribute = defaultHashAttributeOf(initialAttributeSchema);

  const form = useForm<Partial<ExperimentInterfaceStringDates>>({
    defaultValues: {
      project: initialProject,
      name: "",
      trackingKey: "",
      hypothesis: "",
      hashAttribute: initialHashAttribute,
      templateId: "",
      holdoutId: undefined,
      customFields: undefined,
    },
  });

  const trackingKeyFormatProps = useExperimentKeyFieldProps(
    form.watch("trackingKey"),
  );
  const selectedProject = form.watch("project") ?? "";
  const creatingInDemoProject =
    !!demoProjectId && selectedProject === demoProjectId;

  // Re-scope the live options to the selected project
  const attributeSchema = useAttributeSchema(false, selectedProject);
  const hashableAttributes = attributeSchema.filter((a) => a.hashAttribute);
  const selectableAttributes =
    hashableAttributes.length > 0 ? hashableAttributes : attributeSchema;
  const defaultHashAttribute = defaultHashAttributeOf(attributeSchema);
  // The assignment query and identifier follow it, so it's asked whenever
  // there's a choice; with none flagged, the default may be one no SDK sends.
  const askHashAttribute =
    attributeSchema.length > 0 && hashableAttributes.length !== 1;

  const { availableFields: customFields, value: customFieldValues } =
    useReconciledCustomFields({
      section: "experiment",
      project: selectedProject,
      value: form.watch("customFields"),
      setValue: (value) => form.setValue("customFields", value),
    });

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

  const hypothesisLabelId = useId();
  // An image still uploading would be dropped from the saved hypothesis.
  const [hypothesisUploading, setHypothesisUploading] = useState(false);
  const suggestHypothesis = useSuggestHypothesis(
    form.watch("hypothesis") ?? "",
    "simple-new-experiment-form",
  );
  const canSubmit =
    hasProjectPermission && !sdkConnectionsLoading && !hypothesisUploading;

  // When the project changes, drop any selection that's no longer valid there
  useEffect(() => {
    const templateId = form.getValues("templateId");
    if (templateId && !availableTemplates.some((t) => t.value === templateId)) {
      form.setValue("templateId", "");
    }
    const hashAttribute = form.getValues("hashAttribute");
    const validAttributes = selectableAttributes.map((s) => s.property);
    if (!hashAttribute || !validAttributes.includes(hashAttribute)) {
      form.setValue("hashAttribute", defaultHashAttribute);
    }
  }, [selectedProject]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const currentHashAttribute = form.watch("hashAttribute");
  const hashAttributeHoldoutMismatch =
    !!holdoutHashAttribute && currentHashAttribute !== holdoutHashAttribute;
  // The holdout's attribute may not be flagged for hashing, and the field
  // reads as empty unless its value is an option.
  const hashAttributeOptions =
    !currentHashAttribute ||
    selectableAttributes.some((a) => a.property === currentHashAttribute)
      ? selectableAttributes
      : [
          ...selectableAttributes,
          attributeSchema.find((a) => a.property === currentHashAttribute) ?? {
            property: currentHashAttribute,
          },
        ];

  const watchedTemplateId = form.watch("templateId");
  const watchedTemplate = watchedTemplateId
    ? templatesMap.get(watchedTemplateId)
    : undefined;
  const autoDatasourceId = getAutoDatasourceId({
    datasources,
    demoDataSourceId,
    defaultDataSource: settings.defaultDataSource,
    project: selectedProject,
    templateDatasource: watchedTemplate?.datasource,
  });
  const autoDatasource = autoDatasourceId
    ? getDatasourceById(autoDatasourceId)
    : null;
  const unavailableTemplateAssignment = watchedTemplate
    ? resolveTemplateAssignment({
        datasource: autoDatasource ?? undefined,
        project: selectedProject,
        templateExposureQueryId: watchedTemplate.exposureQueryId,
        templateIdentifierType: watchedTemplate.exposureQueryIdentifierType,
      })
    : null;

  const onSubmit = form.handleSubmit(async (rawValue) => {
    const name = (rawValue.name || "").trim();
    if (name.length < 1) {
      throw new Error("Name must not be empty");
    }
    if (templateRequired && !rawValue.templateId) {
      throw new Error("You must select a template");
    }

    let data: Partial<ExperimentInterfaceStringDates>;
    const template = rawValue.templateId
      ? templatesMap.get(rawValue.templateId)
      : undefined;

    if (template) {
      const templateAsExperiment = convertTemplateToExperiment(template);
      // skipPartialData is stored as a boolean on templates but the experiment
      // expects a "strict" | "loose" enum
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

    const project = rawValue.project || "";
    const hashAttribute = rawValue.hashAttribute || defaultHashAttribute;
    if (!hashAttribute) {
      throw new Error("You must select an assignment attribute");
    }

    const hasSDKWithNoBucketingV2 = !allConnectionsSupportBucketingV2(
      sdkConnectionsData?.connections,
      project,
    );
    const hashVersion = hasSDKWithNoBucketingV2 ? 1 : 2;

    const datasourceId = getAutoDatasourceId({
      datasources,
      demoDataSourceId,
      defaultDataSource: settings.defaultDataSource,
      project,
      templateDatasource: data.datasource || "",
    });
    const selectedDatasource = datasourceId
      ? getDatasourceById(datasourceId)
      : null;
    const templateAssignment = resolveTemplateAssignment({
      datasource: selectedDatasource ?? undefined,
      project,
      templateExposureQueryId: data.exposureQueryId,
      templateIdentifierType: data.exposureQueryIdentifierType,
    });
    const exposureQueryId =
      templateAssignment?.kind === "selected"
        ? templateAssignment.exposureQueryId
        : templateAssignment?.kind === "unavailable"
          ? ""
          : getAutoExposureQueryId({
              datasource: selectedDatasource ?? undefined,
              hashAttribute: hashAttribute || "",
              project,
              templateExposureQueryId: data.exposureQueryId || "",
            });
    const exposureQueryIdentifierType =
      templateAssignment?.kind === "selected"
        ? templateAssignment.identifierType
        : templateAssignment?.kind === "unavailable"
          ? undefined
          : getAutoExposureQueryIdentifierType({
              datasource: selectedDatasource ?? undefined,
              hashAttribute: hashAttribute || "",
              exposureQueryId,
              templateIdentifierType: data.exposureQueryIdentifierType,
            });

    data = {
      ...data,
      type: "standard",
      status: "draft",
      project,
      name,
      hypothesis: rawValue.hypothesis || "",
      hashAttribute,
      hashVersion,
      datasource: datasourceId,
      exposureQueryId,
      exposureQueryIdentifierType,
      templateId: rawValue.templateId || "",
      holdoutId: rawValue.holdoutId || undefined,
      customFields: rawValue.customFields,
      // Empty lets the back-end derive a unique key from the name
      trackingKey: rawValue.trackingKey || "",
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

    track("Create Experiment: Simple Flow", {
      source,
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
      ctaEnabled={canSubmit}
      submit={onSubmit}
      close={() => onClose?.()}
      trackingEventModalType="simple-new-experiment-create"
      trackingEventModalSource={source}
      headerAction={
        onSwitchToLegacy && showSwitchToOldExpCreate ? (
          <Link onClick={onSwitchToLegacy} color="gray">
            Switch to old experience
          </Link>
        ) : undefined
      }
    >
      <Flex direction="column" gap="4" mb="4">
        {showSwitchToOldExpCreate && (
          <Callout
            status="info"
            dismissible
            id="new-experiment-create-flow-callout"
          >
            Other experiment configuration steps now live on the experiment
            overview page.
          </Callout>
        )}
        {creatingInDemoProject && (
          <Callout status="warning">
            You are creating an experiment in the Sample Data Project.
          </Callout>
        )}
        <SDKCapabilityWarning
          capability="bucketingV2"
          project={selectedProject}
          someMessage="Using V1 hashing algorithm as some of your SDK Connections may not support V2 hashing."
          noneMessage="Using V1 hashing algorithm as none of your SDK Connections support V2 hashing."
          popoverTriggerText="Show incompatible SDKs"
          size="medium"
        />
      </Flex>
      <Field
        label="Experiment Name"
        required
        minLength={2}
        {...form.register("name")}
      />
      {settings.experimentKeyRegexValidator && (
        <Field
          label="Tracking Key"
          {...form.register("trackingKey")}
          {...trackingKeyFormatProps}
        />
      )}

      {projects.length >= 1 && (
        <SelectField
          label="Project"
          value={selectedProject}
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

      {hasCommercialFeature("templates") && availableTemplates.length >= 1 && (
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
              form.setValue("customFields", undefined);
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
            form.setValue("customFields", templateAsExperiment.customFields);
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
      {unavailableTemplateAssignment?.kind === "unavailable" && (
        <Callout status="warning" mb="3">
          This template&apos;s identifier type (&quot;
          {unavailableTemplateAssignment.identifierType}&quot;) isn&apos;t
          declared by{" "}
          {unavailableTemplateAssignment.outOfScope
            ? "an assignment query scoped to this Project"
            : "any assignment query"}
          . The experiment will be created without assignment settings, so
          choose them before analyzing results.
        </Callout>
      )}

      <HoldoutSelect
        selectedProject={selectedProject}
        selectedHoldoutId={form.watch("holdoutId")}
        setHoldout={(holdoutId) => form.setValue("holdoutId", holdoutId)}
        formType="experiment"
      />

      <Box mb="3">
        <Box id={hypothesisLabelId} mb="1">
          <Text as="label" weight="semibold">
            Hypothesis
          </Text>
        </Box>
        <AIRichTextField
          value={form.watch("hypothesis") ?? ""}
          onChange={(hypothesis) => form.setValue("hypothesis", hypothesis)}
          placeholder="e.g. Making the signup button bigger will increase clicks and ultimately improve revenue"
          height="xs"
          collapsibleToolbar
          aiSuggestFunction={suggestHypothesis}
          aiButtonText="Check hypothesis"
          trackingSource="simple-new-experiment-form"
          onUploadingChange={setHypothesisUploading}
          ariaLabelledBy={hypothesisLabelId}
        />
      </Box>

      {askHashAttribute && (
        <SelectField
          required
          label={
            <>
              <Text weight="semibold" mb="1">
                Assignment attribute
              </Text>
              <Text as="div" color="text-mid">
                Will be hashed together with the tracking key to determine which
                variation to assign
              </Text>
            </>
          }
          className={hashAttributeHoldoutMismatch ? "warning" : undefined}
          value={currentHashAttribute ?? ""}
          onChange={(v) => form.setValue("hashAttribute", v)}
          options={hashAttributeOptions.map(toAttributeOption)}
          formatOptionLabel={formatAttributeOptionLabel}
          helpText={
            hashAttributeHoldoutMismatch ? (
              <HelperText status="warning" size="sm" mt="2">
                The hash attribute of this experiment does not match the hash
                attribute of the holdout this experiment will belong to.
              </HelperText>
            ) : undefined
          }
        />
      )}

      {customFields.length > 0 && (
        <CustomFieldInput
          fields={customFields}
          value={customFieldValues}
          onChange={(value) => form.setValue("customFields", value)}
        />
      )}
    </ModalStandard>
  );
};

export default SimpleNewExperimentForm;
