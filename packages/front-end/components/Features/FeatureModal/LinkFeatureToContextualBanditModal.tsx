import { useForm } from "react-hook-form";
import {
  ContextualBanditRefRule,
  ContextualBanditRefVariation,
  FeatureEnvironment,
  FeatureInterface,
  FeatureValueType,
} from "shared/types/feature";
import { useEffect, useState } from "react";
import { ApiContextualBanditInterface } from "shared/validators";
import { PiArrowSquareOut } from "react-icons/pi";
import { Box, Flex, Separator } from "@radix-ui/themes";
import {
  ensureConfigBacking,
  setConfigBacking,
  valueHasConfigExtends,
} from "shared/util";
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
import { useConfigBacking } from "@/hooks/useConfigBacking";
import { useFeatureMetaInfo } from "@/hooks/useFeatureMetaInfo";
import useApi from "@/hooks/useApi";
import { useWatching } from "@/services/WatchProvider";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import CustomFieldInput from "@/components/CustomFields/CustomFieldInput";
import SelectField from "@/components/Forms/SelectField";
import FeatureValueField from "@/components/Features/FeatureValueField";
import RuleEnvironmentScopeField from "@/components/Features/RuleModal/EnvironmentScopeField";
import {
  filterCustomFieldsForSectionAndProject,
  useCustomFields,
} from "@/hooks/useCustomFields";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useUser } from "@/services/UserContext";
import HelperText from "@/ui/HelperText";
import FeatureKeyField from "./FeatureKeyField";
import TagsField from "./TagsField";
import ValueTypeField from "./ValueTypeField";

export type Props = {
  close: () => void;
  cta?: string;
  cb: ApiContextualBanditInterface;
  existingLinkedFeatureIds?: string[];
  mutate: () => void;
  source?: string;
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
  cb,
  customFields,
}: {
  environments: ReturnType<typeof useEnvironments>;
  permissions: ReturnType<typeof usePermissionsUtil>;
  project: string;
  cb: ApiContextualBanditInterface;
  customFields?: ReturnType<typeof useCustomFields>;
}): Omit<
  FeatureInterface,
  | "organization"
  | "dateCreated"
  | "dateUpdated"
  | "defaultValue"
  | "customFields"
> & {
  variations: ContextualBanditRefVariation[];
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
  const type = cb.variations.length > 2 ? "string" : "boolean";
  const defaultValue = getDefaultValue(type);
  return {
    existing: "",
    valueType: type,
    version: 1,
    description: cb.description || "",
    id: "",
    owner: "",
    project,
    tags: cb.tags || [],
    environmentSettings,
    rules: [],
    customFields: customFieldValues,
    variations: cb.variations.map((v, i) => ({
      value: i ? getDefaultVariationValue(defaultValue) : defaultValue,
      variationId: v.id,
    })),
  };
};

export default function LinkFeatureToContextualBanditModal({
  close,
  cta = "Add",
  cb,
  existingLinkedFeatureIds = [],
  mutate,
  source,
}: Props) {
  const { project, refreshTags } = useDefinitions();
  const selectedProject = cb.project ?? project;
  const environments = useEnvironments();
  const permissionsUtil = usePermissionsUtil();
  const { refreshWatching } = useWatching();
  const { hasCommercialFeature } = useUser();
  const allCustomFields = useCustomFields();
  const customFields = filterCustomFieldsForSectionAndProject(
    allCustomFields,
    "feature",
    selectedProject,
  );

  const defaultValues = genFormDefaultValues({
    environments,
    permissions: permissionsUtil,
    cb,
    project: selectedProject,
    customFields: hasCommercialFeature("custom-metadata")
      ? customFields
      : undefined,
  });

  const { features } = useFeatureMetaInfo({ project: cb.project });

  const validFeatures = features.filter((f) => {
    if (f.archived) return false;
    if (existingLinkedFeatureIds.includes(f.id)) return false;
    return true;
  });

  const form = useForm<ReturnType<typeof genFormDefaultValues>>({
    defaultValues: defaultValues as never,
  });

  const [showTags, setShowTags] = useState(cb.tags && cb.tags.length > 0);
  const [showDescription, setShowDescription] = useState(
    !!cb.description && cb.description.length > 0,
  );

  const [ruleAllEnvironments, setRuleAllEnvironments] = useState<boolean>(true);
  const [ruleSelectedEnvironments, setRuleSelectedEnvironments] = useState<
    string[]
  >([]);

  const { apiCall } = useAuth();

  const valueType = form.watch("valueType") as FeatureValueType;
  const existing = form.watch("existing");
  const variations = cb.variations;

  const { data: existingFeatureData } = useApi<{
    status: 200;
    feature: FeatureInterface;
  }>(`/feature/${existing}`, { shouldRun: () => !!existing });
  const existingFeature = existingFeatureData?.feature;

  // Config-backed existing JSON flags: every variation value is a sparse patch
  // serving the default's config, so the variations use the config-backing
  // editor and each value is seeded with the backing (mirrors
  // useSeedConfigBackedVariations on the feature page; CB rules carry no
  // `sparse` flag — their arm values are inherently patches).
  const { defaultConfigKey, isConfigBacked, configBackingOptionKeys } =
    useConfigBacking(existing ? existingFeature : undefined);
  useEffect(() => {
    if (!isConfigBacked || !defaultConfigKey) return;
    (form.getValues("variations") || []).forEach((v, i) => {
      const normalized = ensureConfigBacking(v.value, defaultConfigKey);
      if (normalized !== v.value) {
        form.setValue(`variations.${i}.value`, normalized);
      }
    });
  }, [isConfigBacked, defaultConfigKey, form]);

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
      trackingEventModalType="feature-from-contextual-bandit"
      trackingEventModalSource={source}
      open
      size="lg"
      header="Add Feature Flag to Contextual Bandit"
      cta={cta}
      close={close}
      ctaEnabled={ctaEnabled}
      submit={form.handleSubmit(async (values) => {
        const { variations, existing, ...feature } = values;

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
          ? undefined
          : {
              ...feature,
              environmentSettings: newFeatureEnvSettings,
              defaultValue: variations[0].value,
            };

        const rule: ContextualBanditRefRule = {
          type: "contextual-bandit-ref",
          description: "",
          id: "",
          allEnvironments: ruleAllEnvironments,
          ...(ruleAllEnvironments
            ? {}
            : { environments: ruleSelectedEnvironments }),
          condition: "",
          enabled: true,
          scheduleRules: [],
          contextualBanditId: cb.id,
          variations,
        };

        const newRule = validateFeatureRule(
          rule,
          featureToCreate ?? { valueType, project: selectedProject },
        );
        if (newRule) {
          form.setValue(
            "variations",
            (newRule as ContextualBanditRefRule).variations,
          );
          throw new Error(
            "We fixed some errors in the feature. If it looks correct, submit again.",
          );
        }

        let targetFeatureId: string;

        if (existing) {
          targetFeatureId = existing;
        } else {
          if (!featureToCreate) {
            throw new Error("Invalid feature selected");
          }
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
            initialRule: "contextual-bandit-ref",
          });
          refreshTags(featureToCreate.tags || []);
          refreshWatching();
        }

        await apiCall(`/feature/${targetFeatureId}/0/contextual-bandit`, {
          method: "POST",
          body: JSON.stringify({
            rule,
            autoPublish: false,
            forceNewDraft: true,
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
              // A config-backed flag serves its config, so seed each variation
              // as a clean backing ref (empty override patch) rather than a
              // copy of the type-transformed default. Selecting a non-config
              // JSON flag strips any backing ref left from a prior selection.
              if (newFeature.valueType === "json") {
                const configKey = newFeature.configBackingKey ?? null;
                (form.getValues("variations") || []).forEach((v, i) => {
                  if (configKey) {
                    form.setValue(
                      `variations.${i}.value`,
                      setConfigBacking(configKey, "{}"),
                    );
                  } else if (valueHasConfigExtends(v.value)) {
                    form.setValue(
                      `variations.${i}.value`,
                      setConfigBacking(null, v.value),
                    );
                  }
                });
              }
            }
          }
          form.setValue("existing", value);
        }}
      />

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
            <Link onClick={() => setShowTags(true)}>+ tags</Link>
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
            <Link onClick={() => setShowDescription(true)}>+ description</Link>
          )}

          <ValueTypeField
            value={valueType}
            onChange={(val) => {
              // config authoring type isn't offered here yet (allowConfig off).
              if (val !== "config") updateValuesOnTypeChange(val);
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
              A rule will be added to the bottom of the rule list as a draft.
              For more control over placement, add the rule directly from the{" "}
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
        <Text as="label" weight="semibold" mb="0">
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
              feature={existing ? existingFeature : undefined}
              useCodeInput={true}
              showFullscreenButton={true}
              sparse={isConfigBacked}
              allowConfigBacking={isConfigBacked}
              configBackingOptionKeys={configBackingOptionKeys}
              configBackingShowPatch={isConfigBacked}
              lockConfigBacking={isConfigBacked}
            />
            {i < variations.length - 1 && <Separator size="4" my="4" />}
          </Box>
        ))}
      </Flex>
    </ModalStandard>
  );
}
