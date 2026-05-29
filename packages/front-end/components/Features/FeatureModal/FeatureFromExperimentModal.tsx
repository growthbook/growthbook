import { useForm } from "react-hook-form";
import {
  ExperimentRefRule,
  ExperimentRefVariation,
  FeatureEnvironment,
  FeatureInterface,
  FeatureValueType,
} from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { useMemo, useState } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { PiArrowSquareOut } from "react-icons/pi";
import { Box, Flex, Separator } from "@radix-ui/themes";
import { filterEnvironmentsByExperiment, getReviewSetting } from "shared/util";
import { getLatestPhaseVariations } from "shared/experiments";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { useAuth } from "@/services/auth";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { useDefinitions } from "@/services/DefinitionsContext";
import track from "@/services/track";
import {
  getDefaultValue,
  useEnvironments,
  getDefaultVariationValue,
  validateFeatureRule,
} from "@/services/features";
import { useFeatureMetaInfo } from "@/hooks/useFeatureMetaInfo";
import { useWatching } from "@/services/WatchProvider";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import CustomFieldInput from "@/components/CustomFields/CustomFieldInput";
import SelectField from "@/components/Forms/SelectField";
import FeatureValueField from "@/components/Features/FeatureValueField";
import RuleEnvironmentScopeField from "@/components/Features/RuleModal/EnvironmentScopeField";
import DraftSelectorDropdown, {
  DraftMode,
} from "@/components/Features/DraftSelectorDropdown";
import {
  filterCustomFieldsForSectionAndProject,
  useCustomFields,
} from "@/hooks/useCustomFields";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useUser } from "@/services/UserContext";
import useApi from "@/hooks/useApi";
import { useHoldouts } from "@/hooks/useHoldouts";
import useOrgSettings from "@/hooks/useOrgSettings";
import HelperText from "@/ui/HelperText";
import FeatureKeyField from "./FeatureKeyField";
import TagsField from "./TagsField";
import ValueTypeField from "./ValueTypeField";

export type Props = {
  close: () => void;
  cta?: string;
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  source?: string;
  // Feature IDs in "discarded" state that can be re-added.
  reAddableFeatureIds?: string[];
};

const genEnvironmentSettings = ({
  environments,
  permissions,
  project,
}: {
  environments: ReturnType<typeof useEnvironments>;
  permissions: ReturnType<typeof usePermissionsUtil>;
  project: string;
}): Record<string, FeatureEnvironment> => {
  const envSettings: Record<string, FeatureEnvironment> = {};
  environments.forEach((e) => {
    const canPublish = permissions.canPublishFeature({ project }, [e.id]);
    envSettings[e.id] = {
      enabled: canPublish ? (e.defaultState ?? true) : false,
    };
  });
  return envSettings;
};

const genFormDefaultValues = ({
  environments,
  permissions,
  project,
  experiment,
  customFields,
}: {
  environments: ReturnType<typeof useEnvironments>;
  permissions: ReturnType<typeof usePermissionsUtil>;
  project: string;
  experiment: ExperimentInterfaceStringDates;
  customFields?: ReturnType<typeof useCustomFields>;
}): Omit<
  FeatureInterface,
  | "organization"
  | "dateCreated"
  | "dateUpdated"
  | "defaultValue"
  | "customFields"
> & {
  variations: ExperimentRefVariation[];
  existing: string;
  customFields: Record<string, string>;
} => {
  const environmentSettings = genEnvironmentSettings({
    environments,
    permissions,
    project,
  });
  const customFieldValues = customFields
    ? Object.fromEntries(
        customFields.map((field) => [field.id, field.defaultValue ?? ""]),
      )
    : {};
  const type =
    getLatestPhaseVariations(experiment).length > 2 ? "string" : "boolean";
  const defaultValue = getDefaultValue(type);
  return {
    existing: "",
    valueType: type,
    version: 1,
    description: experiment.description || "",
    id: "",
    owner: "",
    project,
    tags: experiment.tags || [],
    environmentSettings,
    rules: [],
    customFields: customFieldValues,
    variations: getLatestPhaseVariations(experiment).map((v, i) => {
      return {
        value: i ? getDefaultVariationValue(defaultValue) : defaultValue,
        variationId: v.id,
      };
    }),
  };
};

export default function FeatureFromExperimentModal({
  close,
  cta = "Add",
  experiment,
  mutate,
  source,
  reAddableFeatureIds = [],
}: Props) {
  const { project, refreshTags } = useDefinitions();
  const selectedProject = experiment.project ?? project;
  const allEnvironments = useEnvironments();
  const environments = filterEnvironmentsByExperiment(
    allEnvironments,
    experiment,
  );
  const permissionsUtil = usePermissionsUtil();
  const { refreshWatching } = useWatching();
  const { hasCommercialFeature } = useUser();
  const settings = useOrgSettings();
  const { holdoutsMap } = useHoldouts();
  const allCustomFields = useCustomFields();
  const customFields = filterCustomFieldsForSectionAndProject(
    allCustomFields,
    "feature",
    selectedProject,
  );

  const defaultValues = genFormDefaultValues({
    environments,
    permissions: permissionsUtil,
    experiment,
    project: selectedProject,
    customFields: hasCommercialFeature("custom-metadata")
      ? customFields
      : undefined,
  });

  const { features } = useFeatureMetaInfo({ project: experiment.project });

  const validFeatures = features.filter((f) => {
    if (f.archived) return false;
    // Allow re-adding features whose draft was discarded.
    if (reAddableFeatureIds.includes(f.id)) return true;
    if (experiment.linkedFeatures?.includes(f.id)) return false;
    return true;
  });

  // react-hook-form's DefaultValues<T> cannot accept `unknown` fields — it maps
  // them to {} | undefined, which excludes null. force: unknown in FeatureRulePatch
  // propagates through FeatureRule.rampActions and triggers this constraint. Since
  // rules is always [] in these defaults and the form never sets rampActions fields,
  // the explicit type parameter preserves full form type safety while the cast
  // bypasses the DefaultValues constraint check.
  const form = useForm<ReturnType<typeof genFormDefaultValues>>({
    defaultValues: defaultValues as never,
  });

  const [showTags, setShowTags] = useState(
    experiment.tags && experiment.tags.length > 0,
  );
  const [showDescription, setShowDescription] = useState(
    experiment.description && experiment.description.length > 0,
  );

  const [ruleAllEnvironments, setRuleAllEnvironments] = useState<boolean>(true);
  const [ruleSelectedEnvironments, setRuleSelectedEnvironments] = useState<
    string[]
  >([]);

  const [draftMode, setDraftMode] = useState<DraftMode>("new");
  const [selectedDraft, setSelectedDraft] = useState<number | null>(null);

  const { apiCall } = useAuth();

  const valueType = form.watch("valueType") as FeatureValueType;
  const existing = form.watch("existing");
  const variations = getLatestPhaseVariations(experiment);

  const { data: existingFeatureData } = useApi<{
    status: 200;
    feature: FeatureInterface;
    revisions: MinimalFeatureRevisionInterface[];
  }>(`/feature/${existing}`, { shouldRun: () => !!existing });
  const existingFeature = existingFeatureData?.feature;
  const existingRevisionList = existingFeatureData?.revisions ?? [];

  // Pessimistic default ("all") until the FF loads so publish-now stays gated.
  const gatedEnvSet: Set<string> | "all" | "none" = useMemo(() => {
    if (!existing || !existingFeature) return "all";
    const raw = settings?.requireReviews;
    if (raw === true) return "all";
    if (!Array.isArray(raw)) return "none";
    const reviewSetting = getReviewSetting(raw, existingFeature);
    if (!reviewSetting?.requireReviewOn) return "none";
    const envs = reviewSetting.environments ?? [];
    return envs.length === 0 ? "all" : new Set(envs);
  }, [existing, existingFeature, settings?.requireReviews]);

  const canAutoPublish = useMemo(() => {
    if (!existingFeature) return false;
    if (permissionsUtil.canBypassApprovalChecks(existingFeature)) return true;
    return gatedEnvSet === "none";
  }, [existingFeature, permissionsUtil, gatedEnvSet]);

  const holdoutWarning = useMemo<string | null>(() => {
    if (!existing || !existingFeature || !experiment.holdoutId) return null;
    const featureHoldoutId = existingFeature.holdout?.id;
    const holdout = holdoutsMap.get(experiment.holdoutId);
    const holdoutName = holdout?.name ?? "Unknown holdout";
    if (!featureHoldoutId) {
      const covers =
        !!holdout && holdout.projects.includes(existingFeature.project ?? "");
      return covers
        ? `This experiment belongs to holdout "${holdoutName}", but the selected feature isn't enrolled in it. Visit the feature page and use "Add to holdout" to enroll it, then try again.`
        : `This experiment belongs to holdout "${holdoutName}", which is unavailable in the selected feature's project. Update the holdout's project scope, or select a feature in a project covered by the holdout.`;
    }
    if (featureHoldoutId !== experiment.holdoutId) {
      return `Holdout mismatch: the experiment and the selected feature are in different holdouts. They must share the same holdout to be linked.`;
    }
    return null;
  }, [existing, existingFeature, experiment.holdoutId, holdoutsMap]);

  let ctaEnabled = true;
  let disabledMessage: string | undefined;

  if (
    !permissionsUtil.canManageFeatureDrafts({
      project: selectedProject,
    })
  ) {
    ctaEnabled = false;
    disabledMessage =
      "You don't have permission to create feature flag drafts.";
  }

  if (holdoutWarning) {
    ctaEnabled = false;
  }

  function updateValuesOnTypeChange(val: FeatureValueType) {
    if (val === valueType) return;

    form.setValue("valueType", val);

    const transformValue = (v: string) => {
      if (val === "boolean") {
        return Boolean(v) && v !== "false" ? "true" : "false";
      } else if (val === "number") {
        return (Number(v) || 0) + "";
      } else if (val === "json") {
        if (valueType === "string")
          return `{\n  "value": ${JSON.stringify(v)}\n}`;
        return `{\n  "value": ${v}\n}`;
      } else {
        return v;
      }
    };

    form.setValue(
      "variations",
      form.watch("variations").map((v) => ({
        ...v,
        value: transformValue(v.value),
      })),
    );
  }

  return (
    <ModalStandard
      trackingEventModalType="feature-from-experiment"
      trackingEventModalSource={source}
      open
      size="lg"
      header="Add Feature Flag to Experiment"
      headerAction={
        existing && existingFeature ? (
          <DraftSelectorDropdown
            feature={existingFeature}
            revisionList={existingRevisionList}
            mode={draftMode}
            setMode={setDraftMode}
            selectedDraft={selectedDraft}
            setSelectedDraft={setSelectedDraft}
            canAutoPublish={canAutoPublish}
            gatedEnvSet={gatedEnvSet}
          />
        ) : null
      }
      cta={cta}
      close={close}
      ctaEnabled={ctaEnabled}
      submit={form.handleSubmit(async (values) => {
        const { variations, existing, ...feature } = values;

        const featureFromCache = existing ? existingFeature : undefined;

        const newFeatureEnvSettings: Record<string, FeatureEnvironment> = {};
        if (!existing) {
          environments.forEach((env) => {
            newFeatureEnvSettings[env.id] = { enabled: false };
          });
        }

        const featureToCreate:
          | undefined
          | Omit<
              FeatureInterface,
              "organization" | "dateCreated" | "dateUpdated"
            > = existing
          ? featureFromCache
          : {
              ...feature,
              environmentSettings: newFeatureEnvSettings,
              defaultValue: variations[0].value,
              holdout: experiment.holdoutId
                ? {
                    id: experiment.holdoutId,
                    value: variations[0].value,
                  }
                : undefined,
            };

        if (!featureToCreate) {
          throw new Error("Invalid feature selected");
        }

        const rule: ExperimentRefRule = {
          type: "experiment-ref",
          description: "",
          id: "",
          allEnvironments: ruleAllEnvironments,
          ...(ruleAllEnvironments
            ? {}
            : { environments: ruleSelectedEnvironments }),
          condition: "",
          enabled: true,
          scheduleRules: [],
          experimentId: experiment.id,
          variations,
        };

        const newRule = validateFeatureRule(rule, featureToCreate);
        if (newRule) {
          form.setValue(
            "variations",
            (newRule as ExperimentRefRule).variations,
          );
          throw new Error(
            "We fixed some errors in the feature. If it looks correct, submit again.",
          );
        }

        let targetFeatureId: string;

        if (existing) {
          if (holdoutWarning)
            throw new Error("Holdout configuration mismatch.");

          targetFeatureId = featureToCreate.id;
        } else {
          const created = await apiCall<{ feature: FeatureInterface }>(
            `/feature`,
            {
              method: "POST",
              body: JSON.stringify(featureToCreate),
            },
          );
          if (!created?.feature?.id) {
            throw new Error("Feature creation failed");
          }
          targetFeatureId = created.feature.id;

          track("Feature Created", {
            valueType: featureToCreate.valueType,
            hasDescription: featureToCreate.description
              ? featureToCreate.description.length > 0
              : false,
            initialRule: "experiment-ref",
          });
          refreshTags(featureToCreate.tags || []);
          refreshWatching();
        }

        const autoPublish = existing && draftMode === "publish";
        const draftVersion =
          existing && draftMode === "existing" && selectedDraft !== null
            ? selectedDraft
            : undefined;
        const forceNewDraft = !existing || draftMode === "new";

        await apiCall(`/feature/${targetFeatureId}/0/experiment`, {
          method: "POST",
          body: JSON.stringify({
            rule,
            autoPublish,
            draftVersion,
            forceNewDraft,
          }),
        });

        await mutate();
      })}
    >
      <SelectField
        label="Create New or Use Existing?"
        options={validFeatures.map((f) => ({
          label: f.id + " (" + f.valueType + ")",
          value: f.id,
        }))}
        initialOption="Create New Feature"
        value={form.watch("existing")}
        onChange={(value) => {
          if (value) {
            const newFeature = validFeatures.find((f) => f.id === value);
            if (newFeature) {
              updateValuesOnTypeChange(newFeature.valueType);
            }
          }

          form.setValue("existing", value);
          setDraftMode("new");
          setSelectedDraft(null);
        }}
      />

      {holdoutWarning && (
        <Callout status="warning" mb="3">
          {holdoutWarning}
        </Callout>
      )}

      {disabledMessage && (
        <Callout status="warning" mb="3">
          {disabledMessage}
        </Callout>
      )}

      {!existing && (
        <>
          <FeatureKeyField keyField={form.register("id")} />

          {showTags ? (
            <TagsField
              value={form.watch("tags") || []}
              onChange={(tags) => form.setValue("tags", tags)}
            />
          ) : (
            <a
              href="#"
              className="badge badge-light badge-pill mr-3 mb-3"
              onClick={(e) => {
                e.preventDefault();
                setShowTags(true);
              }}
            >
              + tags
            </a>
          )}

          {showDescription ? (
            <div className="form-group">
              <label>Description</label>
              <MarkdownInput
                value={form.watch("description") || ""}
                setValue={(value) => form.setValue("description", value)}
                autofocus={true}
              />
            </div>
          ) : (
            <a
              href="#"
              className="badge badge-light badge-pill mb-3"
              onClick={(e) => {
                e.preventDefault();
                setShowDescription(true);
              }}
            >
              + description
            </a>
          )}

          <ValueTypeField
            value={valueType}
            onChange={(val) => {
              updateValuesOnTypeChange(val);
            }}
          />

          <RuleEnvironmentScopeField
            environments={environments}
            allEnvironments={ruleAllEnvironments}
            setAllEnvironments={setRuleAllEnvironments}
            selectedEnvironments={ruleSelectedEnvironments}
            setSelectedEnvironments={setRuleSelectedEnvironments}
            label="Environments"
            my="5"
          />

          {hasCommercialFeature("custom-metadata") &&
            customFields &&
            customFields.length > 0 && (
              <div>
                <CustomFieldInput
                  customFields={customFields}
                  setCustomFields={(value) => {
                    form.setValue("customFields", value);
                  }}
                  currentCustomFields={form.watch("customFields") || {}}
                  section={"feature"}
                  project={selectedProject}
                />
              </div>
            )}
        </>
      )}

      {existing && (
        <>
          <HelperText status="info">
            <Box>
              A rule will be added to the bottom of the rule list. For more
              control over placement, add Experiment rules directly from the{" "}
              <Link href={`/features/${existing}`} target="_blank">
                Feature page
                <PiArrowSquareOut className="ml-1" />
              </Link>{" "}
              instead.
            </Box>
          </HelperText>

          <RuleEnvironmentScopeField
            environments={environments}
            allEnvironments={ruleAllEnvironments}
            setAllEnvironments={setRuleAllEnvironments}
            selectedEnvironments={ruleSelectedEnvironments}
            setSelectedEnvironments={setRuleSelectedEnvironments}
            label="Environments"
            my="5"
          />
        </>
      )}

      <Flex direction="column" gap="3" pt="2">
        <Text as="label" weight="semibold">
          Variation Values
        </Text>
        {variations.map((v, i) => (
          <Box key={v.id}>
            <Flex align="center" direction="row" gap="1" mb="3">
              <Box className={`variation with-variation-label variation${i}`}>
                <span
                  className="label"
                  style={{
                    width: 18,
                    height: 18,
                    fontSize: 11,
                    lineHeight: "18px",
                  }}
                >
                  {i}
                </span>
              </Box>
              <Text weight="semibold">{v.name}</Text>
            </Flex>
            <FeatureValueField
              id={v.id}
              value={form.watch(`variations.${i}.value`) || ""}
              setValue={(val) => form.setValue(`variations.${i}.value`, val)}
              valueType={valueType}
              useCodeInput={true}
              showFullscreenButton={true}
            />
            {i < variations.length - 1 && <Separator size="4" my="4" />}
          </Box>
        ))}
      </Flex>
    </ModalStandard>
  );
}
