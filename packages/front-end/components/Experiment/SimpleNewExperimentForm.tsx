import { FC, useEffect } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/router";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { getEqualWeights } from "shared/experiments";
import {
  getManagedWarehouseExposureQueryIdForAttribute,
  isProjectListValidForProject,
} from "shared/util";
import { Flex } from "@radix-ui/themes";
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
import {
  filterCustomFieldsForSectionAndProject,
  useCustomFields,
} from "@/hooks/useCustomFields";
import CustomFieldInput from "@/components/CustomFields/CustomFieldInput";
import { getDefaultVariations } from "@/components/Experiment/NewExperimentForm";
import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import SDKCapabilityWarning from "@/components/Features/SDKCapabilityWarning";
import { allConnectionsSupportBucketingV2 } from "@/components/Experiment/HashVersionSelector";
import useSDKConnections from "@/hooks/useSDKConnections";
import Text from "@/ui/Text";

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
  templateExposureQueryId,
}: {
  datasource?: DataSourceInterfaceWithParams;
  hashAttribute: string;
  templateExposureQueryId?: string;
}): string {
  const dsSettings = datasource?.settings;
  const exposureQueries = dsSettings?.queries?.exposure || [];

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
    return getManagedWarehouseExposureQueryIdForAttribute({
      settings: datasource.settings,
      attribute: hashAttribute,
    });
  }

  if (exposureQueries.length > 1) {
    // A hash attribute can be linked to multiple identifier types, each with
    // its own query. Only auto-select when exactly one query is linked across
    // all matching identifier types.
    const linkedUserIdTypes =
      dsSettings?.userIdTypes
        ?.filter((t) => t.attributes?.includes(hashAttribute))
        .map((t) => t.userIdType) || [];
    const matchingQueries = exposureQueries.filter((q) =>
      linkedUserIdTypes.includes(q.userIdType),
    );
    if (matchingQueries.length === 1) return matchingQueries[0].id;
  }
  return "";
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
  const { demoDataSourceId } = useDemoDataSourceProject();
  const { data: sdkConnectionsData, isLoading: sdkConnectionsLoading } =
    useSDKConnections();

  const showSwitchToOldExpCreate = useFeatureIsOn(
    "show-switch-to-old-exp-create",
  );

  const initialProject = ctxProject || "";

  const initialAttributeSchema = useAttributeSchema(false, initialProject);
  const initialHashAttributes = initialAttributeSchema
    .filter((a) => a.hashAttribute)
    .map((a) => a.property);
  const initialHashAttribute =
    initialHashAttributes.length === 1 ? initialHashAttributes[0] : "";

  const form = useForm<Partial<ExperimentInterfaceStringDates>>({
    defaultValues: {
      project: initialProject,
      name: "",
      hypothesis: "",
      hashAttribute: initialHashAttribute,
      templateId: "",
      holdoutId: undefined,
      customFields: undefined,
    },
  });

  const selectedProject = form.watch("project") ?? "";

  // Re-scope the live options to the selected project
  const attributeSchema = useAttributeSchema(false, selectedProject);
  const hashAttributes = attributeSchema
    .filter((a) => a.hashAttribute)
    .map((a) => a.property);
  const hasHashAttributes = hashAttributes.length > 0;
  const defaultHashAttribute =
    hashAttributes.length === 1 ? hashAttributes[0] : "";

  const customFields = filterCustomFieldsForSectionAndProject(
    useCustomFields(),
    "experiment",
    selectedProject,
  );

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

  const canSubmit = hasProjectPermission && !sdkConnectionsLoading;

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

  const hashAttributeHoldoutMismatch =
    !!holdoutHashAttribute &&
    form.watch("hashAttribute") !== holdoutHashAttribute;

  const watchedHashAttribute = form.watch("hashAttribute") || "id";
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
  const autoDsExposureQueries =
    autoDatasource?.settings?.queries?.exposure || [];
  const hashAttributeLinkedToIdentifier = (
    autoDatasource?.settings?.userIdTypes || []
  ).some((t) => t.attributes?.includes(watchedHashAttribute));
  const wouldAutoSelectExposureQuery =
    getAutoExposureQueryId({
      datasource: autoDatasource ?? undefined,
      hashAttribute: watchedHashAttribute,
      templateExposureQueryId: watchedTemplate?.exposureQueryId,
    }) !== "";
  const showLinkIdentifierCallout =
    !!autoDatasource &&
    autoDatasource.type !== "growthbook_clickhouse" &&
    permissionsUtil.canUpdateDataSourceSettings(autoDatasource) &&
    autoDsExposureQueries.length > 0 &&
    !hashAttributeLinkedToIdentifier &&
    !wouldAutoSelectExposureQuery;

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
    const hashAttribute = rawValue.hashAttribute;
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
    const exposureQueryId = getAutoExposureQueryId({
      datasource: selectedDatasource ?? undefined,
      hashAttribute: hashAttribute || "",
      templateExposureQueryId: data.exposureQueryId || "",
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
      templateId: rawValue.templateId || "",
      holdoutId: rawValue.holdoutId || undefined,
      customFields: rawValue.customFields,
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
        required
        label={
          <>
            <Text weight="semibold" mb="1">
              Assignment Attribute
            </Text>
            <Text as="div" color="text-mid">
              Will be hashed together with the Tracking Key to determine which
              variation to assign
            </Text>
          </>
        }
        className={hashAttributeHoldoutMismatch ? "warning" : undefined}
        value={form.watch("hashAttribute") ?? ""}
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
        helpText={
          hashAttributeHoldoutMismatch ? (
            <HelperText status="warning" size="sm" mt="2">
              The hash attribute of this experiment does not match the hash
              attribute of the holdout this experiment will belong to.
            </HelperText>
          ) : undefined
        }
      />
      {showLinkIdentifierCallout && autoDatasource && (
        <Callout status="info" mb="3">
          Link the <strong>{watchedHashAttribute}</strong> attribute to an
          identifier type in{" "}
          <Link
            href={`/datasources/${autoDatasource.id}`}
            target="_blank"
            rel="noreferrer"
            onClick={() =>
              track("Link Hash Attribute to Identifier Type", {
                source: "Simple Experiment Creation Flow",
                datasource: autoDatasource.id,
                hashAttribute: watchedHashAttribute,
              })
            }
          >
            {autoDatasource.name}
          </Link>{" "}
          to automatically select an assignment query when creating an
          experiment.
        </Callout>
      )}

      {hasCommercialFeature("custom-metadata") && !!customFields?.length && (
        <CustomFieldInput
          customFields={customFields}
          currentCustomFields={form.watch("customFields") || {}}
          setCustomFields={(value) => {
            form.setValue("customFields", value);
          }}
          section={"experiment"}
          project={selectedProject}
        />
      )}
    </ModalStandard>
  );
};

export default SimpleNewExperimentForm;
