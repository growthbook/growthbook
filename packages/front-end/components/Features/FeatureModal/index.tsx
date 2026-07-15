import { useForm, FormProvider } from "react-hook-form";
import {
  FeatureEnvironment,
  FeatureInterface,
  FeatureValueType,
} from "shared/types/feature";
import React, { ReactElement, useMemo, useState } from "react";
import {
  validateFeatureValue,
  getConfigBackingKey,
  getConfigBackingPatch,
  getConfigSubtree,
  setConfigBacking,
  stripConfigExtends,
  orderConfigsByLineage,
  isScopedConfig,
} from "shared/util";
import { PiInfo } from "react-icons/pi";
import { Box, Flex } from "@radix-ui/themes";
import { HoldoutSelect } from "@/components/Holdout/HoldoutSelect";
import { useFeatureMetaInfo } from "@/hooks/useFeatureMetaInfo";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import { useDefinitions } from "@/services/DefinitionsContext";
import track from "@/services/track";
import {
  genDuplicatedKey,
  getDefaultValue,
  parseDefaultValue,
  useEnvironments,
} from "@/services/features";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useWatching } from "@/services/WatchProvider";
import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import CustomFieldInput from "@/components/CustomFields/CustomFieldInput";
import {
  filterCustomFieldsForSectionAndProject,
  useCustomFields,
} from "@/hooks/useCustomFields";
import { useUser } from "@/services/UserContext";
import FeatureValueField from "@/components/Features/FeatureValueField";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useProjectOptions from "@/hooks/useProjectOptions";
import useOrgSettings from "@/hooks/useOrgSettings";
import SelectField from "@/components/Forms/SelectField";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import FeatureKeyField from "./FeatureKeyField";
import EnvironmentSelect from "./EnvironmentSelect";
import TagsField from "./TagsField";
import ValueTypeField from "./ValueTypeField";

export type Props = {
  close?: () => void;
  onSuccess: (feature: FeatureInterface) => Promise<void>;
  inline?: boolean;
  cta?: string;
  secondaryCTA?: ReactElement;
  featureToDuplicate?: FeatureInterface;
  features?: FeatureInterface[];
};

const genEnvironmentSettings = ({
  environments,
  featureToDuplicate,
  permissions,
  project,
}: {
  environments: ReturnType<typeof useEnvironments>;
  featureToDuplicate?: FeatureInterface;
  permissions: ReturnType<typeof usePermissionsUtil>;
  project: string;
}): Record<string, FeatureEnvironment> => {
  const envSettings: Record<string, FeatureEnvironment> = {};

  environments.forEach((e) => {
    const canPublish = permissions.canPublishFeature({ project }, [e.id]);
    const defaultEnabled = canPublish ? (e.defaultState ?? true) : false;
    const enabled = canPublish
      ? (featureToDuplicate?.environmentSettings?.[e.id]?.enabled ??
        defaultEnabled)
      : false;

    envSettings[e.id] = { enabled };
  });

  return envSettings;
};

const genFormDefaultValues = ({
  environments,
  permissions: permissionsUtil,
  featureToDuplicate,
  project,
  customFields,
}: {
  environments: ReturnType<typeof useEnvironments>;
  permissions: ReturnType<typeof usePermissionsUtil>;
  featureToDuplicate?: FeatureInterface;
  project: string;
  customFields?: ReturnType<typeof useCustomFields>;
}): Pick<
  FeatureInterface,
  | "valueType"
  | "defaultValue"
  | "description"
  | "tags"
  | "project"
  | "id"
  | "environmentSettings"
  | "rules"
  | "customFields"
  | "holdout"
  | "jsonSchema"
> => {
  const environmentSettings = genEnvironmentSettings({
    environments,
    featureToDuplicate,
    permissions: permissionsUtil,
    project,
  });
  const customFieldValues = customFields
    ? Object.fromEntries(
        customFields.map((field) => [
          field.id,
          featureToDuplicate?.customFields?.[field.id] ?? field.defaultValue,
        ]),
      )
    : {};

  return featureToDuplicate
    ? {
        valueType: featureToDuplicate.valueType,
        defaultValue: featureToDuplicate.defaultValue,
        description: featureToDuplicate.description,
        id: genDuplicatedKey(featureToDuplicate),
        project: featureToDuplicate.project ?? project,
        tags: featureToDuplicate.tags,
        environmentSettings,
        rules: featureToDuplicate.rules ?? [],
        customFields: customFieldValues,
        holdout: featureToDuplicate.holdout?.id
          ? featureToDuplicate.holdout
          : undefined,
        jsonSchema: featureToDuplicate.jsonSchema,
      }
    : {
        valueType: "" as FeatureValueType,
        defaultValue: getDefaultValue("boolean"),
        description: "",
        id: "",
        project,
        tags: [],
        environmentSettings,
        rules: [],
        customFields: customFieldValues,
        holdout: undefined,
      };
};

export default function FeatureModal({
  close,
  onSuccess,
  inline,
  cta = "Create",
  secondaryCTA,
  featureToDuplicate,
}: Props) {
  const { project, refreshTags, configs } = useDefinitions();
  const environments = useEnvironments();
  const permissionsUtil = usePermissionsUtil();
  const { refreshWatching } = useWatching();
  const { hasCommercialFeature } = useUser();
  const { requireProjectForFeatures } = useOrgSettings();

  const allCustomFields = useCustomFields();
  const initialCustomFields = filterCustomFieldsForSectionAndProject(
    allCustomFields,
    "feature",
    project,
  );

  const defaultValues = genFormDefaultValues({
    environments,
    permissions: permissionsUtil,
    featureToDuplicate,
    project,
    customFields: hasCommercialFeature("custom-metadata")
      ? initialCustomFields
      : undefined,
  });

  const [showDescription, setShowDescription] = useState(
    !!defaultValues.description?.length,
  );
  const [showTags, setShowTags] = useState(!!defaultValues.tags?.length);
  // The default value is rarely changed at creation time (it falls back to the
  // type default / bare config), so it's progressively disclosed behind a link.
  const [showDefaultValue, setShowDefaultValue] = useState(false);

  const form = useForm({ defaultValues });

  const projectOptions = useProjectOptions(
    (project) =>
      permissionsUtil.canCreateFeature({ project }) &&
      permissionsUtil.canManageFeatureDrafts({ project }),
    project ? [project] : [],
  );
  const canCreateWithoutProject =
    !requireProjectForFeatures && permissionsUtil.canViewFeatureModal();
  const selectedProject = form.watch("project");
  const customFields = filterCustomFieldsForSectionAndProject(
    allCustomFields,
    "feature",
    selectedProject,
  );
  const { projectId: demoProjectId } = useDemoDataSourceProject();
  const { apiCall } = useAuth();
  // During early onboarding the holdouts promo is noise. We still want to show
  // the real holdout selector if the org has set holdouts up.
  const { features: allFeatures } = useFeatureMetaInfo();
  const hideHoldoutPromo = allFeatures.length < 5;

  const valueType = form.watch("valueType") as FeatureValueType;
  const environmentSettings = form.watch("environmentSettings");

  // "config" is a UI authoring type: stored as valueType "json" but the default
  // value must be backed by a config. Tracked separately from the stored type.
  // Seed from the source when duplicating so a config-backed flag stays one (the
  // type/config pickers are hidden in duplicate mode).
  const duplicateBaseConfig = featureToDuplicate?.baseConfig ?? null;
  const [configType, setConfigType] = useState(duplicateBaseConfig !== null);
  // The chosen base config (the feature's authoritative `baseConfig`). The
  // default-value editor's own picker is constrained to this config's family and
  // seeds from it; picking a descendant there layers an extra config on top.
  const [baseConfigKey, setBaseConfigKey] = useState<string | null>(
    duplicateBaseConfig,
  );

  const eligibleBaseConfigs = useMemo(
    () =>
      configs.filter(
        (c) =>
          !c.archived &&
          // Env/project overrides are variants of another config, never an
          // independent base — they must stay implicit (never selectable as a
          // feature's backing config), matching the value-field picker.
          !isScopedConfig(c) &&
          (!c.project || !selectedProject || c.project === selectedProject),
      ),
    [configs, selectedProject],
  );
  const baseConfigOptions = useMemo(
    () =>
      orderConfigsByLineage(eligibleBaseConfigs).map(({ config, depth }) => ({
        label: config.name,
        value: config.key,
        depth,
      })),
    [eligibleBaseConfigs],
  );

  const modalHeader = featureToDuplicate
    ? `Duplicate Feature (${featureToDuplicate.id})`
    : "Create Feature";

  let ctaEnabled = true;
  let disabledMessage: string | undefined;

  if (
    !permissionsUtil.canManageFeatureDrafts({
      project: featureToDuplicate?.project ?? selectedProject,
    })
  ) {
    ctaEnabled = false;
    disabledMessage =
      !selectedProject && projectOptions.length > 0
        ? "Select a project to continue."
        : "You don't have permission to create feature flag drafts.";
  }

  // We want to show a warning when someone tries to create a feature under the demo project
  const { currentProjectIsDemo } = useDemoDataSourceProject();

  return (
    <Modal
      useRadixButton={false}
      trackingEventModalType=""
      open
      size="lg"
      inline={inline}
      header={modalHeader}
      cta={cta}
      close={close}
      ctaEnabled={ctaEnabled}
      disabledMessage={disabledMessage}
      secondaryCTA={secondaryCTA}
      submit={form.handleSubmit(async (values) => {
        const { defaultValue, ...feature } = values;
        const valueType = feature.valueType;
        const { holdout } = feature;

        if (!valueType) {
          throw new Error("Please select a value type");
        }

        // A "config" flag must actually pick a base config.
        if (configType && !baseConfigKey) {
          throw new Error("Select a base config for this config flag");
        }

        // When duplicating, skip JSON schema validation since the value is
        // copied verbatim from an existing feature and the user cannot edit it.
        const featureForValidation = featureToDuplicate
          ? { valueType: feature.valueType }
          : feature;
        const newDefaultValue = validateFeatureValue(
          featureForValidation,
          defaultValue,
          "Value",
        );
        let hasChanges = false;
        if (newDefaultValue !== defaultValue) {
          form.setValue("defaultValue", newDefaultValue);
          hasChanges = true;
        }

        if (hasChanges) {
          throw new Error(
            "We fixed some errors in the feature. If it looks correct, submit again.",
          );
        }

        // "config" flags are stored first-class: the mainline picker's choice is
        // the authoritative `baseConfig`. The default is exactly a config (no
        // overrides): when it matches the base (the common case) we store an empty
        // patch, otherwise it kept a descendant config as its `$extends` layer,
        // which we preserve.
        const configKey = configType ? baseConfigKey : null;
        const defaultOwnConfig = getConfigBackingKey(defaultValue);
        const parsedDefault = parseDefaultValue(defaultValue, valueType);
        const storedDefault =
          configKey !== null
            ? defaultOwnConfig === null || defaultOwnConfig === configKey
              ? getConfigBackingPatch(defaultValue)
              : defaultValue
            : // Non-config flag: strip any manually-entered `@config:` so a plain
              // JSON flag can never carry config backing (keeps `@const:` refs).
              (stripConfigExtends(parsedDefault) ?? parsedDefault);

        const body = {
          ...feature,
          baseConfig: configKey,
          defaultValue: storedDefault,
          holdout: {
            id: holdout?.id ?? "",
            value: storedDefault,
          },
        };

        const res = await apiCall<{ feature: FeatureInterface }>(`/feature`, {
          method: "POST",
          body: JSON.stringify(body),
        });

        track("Feature Created", {
          valueType: values.valueType,
          hasDescription: !!values.description?.length,
          initialRule: "none",
        });
        values.tags && refreshTags(values.tags);
        refreshWatching();

        await onSuccess(res.feature);
      })}
    >
      <FormProvider {...form}>
        {currentProjectIsDemo && (
          <Callout status="warning" mb="3">
            You are creating a feature under the demo datasource project.
          </Callout>
        )}

        <FeatureKeyField keyField={form.register("id")} />

        {projectOptions.length > 0 && (
          <>
            {selectedProject === demoProjectId && (
              <Callout status="warning" mb="3">
                You are creating a feature under the demo datasource project.
              </Callout>
            )}
            <SelectField
              label={
                <>
                  Project{" "}
                  <Tooltip body="The dropdown below has been filtered to only include projects where you have permission to update Features" />
                </>
              }
              value={selectedProject || ""}
              onChange={(v) => {
                form.setValue("project", v);
              }}
              initialOption={canCreateWithoutProject ? "None" : undefined}
              options={projectOptions}
              required={requireProjectForFeatures}
            />
          </>
        )}

        <HoldoutSelect
          selectedProject={selectedProject}
          selectedHoldoutId={form.watch("holdout")?.id}
          setHoldout={(holdoutId) => {
            form.setValue("holdout", { id: holdoutId, value: "" });
          }}
          formType="feature"
          hideEmptyStatePromo={hideHoldoutPromo}
        />

        {!featureToDuplicate && (
          <ValueTypeField
            allowConfig
            value={configType ? "config" : valueType}
            onChange={(val) => {
              if (val === "config") {
                setConfigType(true);
                form.setValue("valueType", "json");
                // Seed the base config with the first eligible; the mainline
                // picker below drives it. The default value starts as a bare
                // patch on that base.
                const seed = eligibleBaseConfigs[0]?.key ?? null;
                setBaseConfigKey(seed);
                form.setValue(
                  "defaultValue",
                  seed ? setConfigBacking(seed, "{}") : "{}",
                );
              } else {
                setConfigType(false);
                setBaseConfigKey(null);
                form.setValue("valueType", val);
                form.setValue("defaultValue", getDefaultValue(val));
              }
            }}
          />
        )}

        {!featureToDuplicate &&
          configType &&
          eligibleBaseConfigs.length === 0 && (
            <Callout status="info" mb="3">
              No configs available in this project yet.{" "}
              <Link href="/configs" target="_blank">
                Create a config
              </Link>{" "}
              to back this flag.
            </Callout>
          )}

        {!featureToDuplicate &&
          configType &&
          eligibleBaseConfigs.length > 0 && (
            <SelectField
              label="Config"
              value={baseConfigKey ?? ""}
              placeholder="Choose a config..."
              options={baseConfigOptions}
              formatOptionLabel={(option, meta) => {
                const depth = (option as { depth?: number }).depth ?? 0;
                return (
                  <Flex
                    as="span"
                    align="center"
                    gap="2"
                    width="100%"
                    style={
                      meta.context === "menu" && depth
                        ? { paddingLeft: depth * 16 }
                        : undefined
                    }
                  >
                    <span>{option.label}</span>
                    <code
                      style={{
                        marginLeft: "auto",
                        paddingLeft: "var(--space-5)",
                        color: "var(--slate-12)",
                      }}
                    >
                      {option.value}
                    </code>
                  </Flex>
                );
              }}
              onChange={(key) => {
                setBaseConfigKey(key || null);
                // Re-point the default value onto the new base, keeping its patch.
                const patch = getConfigBackingPatch(form.watch("defaultValue"));
                form.setValue(
                  "defaultValue",
                  key ? setConfigBacking(key, patch) : patch,
                );
              }}
              sort={false}
              required
              helpText="The config that backs this flag. The default value and any rules override it with a patch."
            />
          )}

        {/*
          We hide rule configuration when duplicating a feature since the
          decision of which rule to display (out of potentially many) in the
          modal is not deterministic.
        */}
        {!featureToDuplicate && valueType && !showDefaultValue && (
          <Box mb="5">
            <Link onClick={() => setShowDefaultValue(true)}>
              {configType ? "+ Choose default config" : "+ Set default value"}
            </Link>
          </Box>
        )}

        {!featureToDuplicate && valueType && showDefaultValue && (
          <FeatureValueField
            label={
              <>
                Default Value when Enabled{" "}
                <Tooltip
                  body={
                    <>
                      After creating your feature, you will be able to add
                      targeted rules such as <strong>A/B Tests</strong> and{" "}
                      <strong>Percentage Rollouts</strong> to control exactly
                      how it gets released to users.
                    </>
                  }
                >
                  <PiInfo style={{ color: "var(--violet-11)" }} />
                </Tooltip>
              </>
            }
            id="defaultValue"
            value={form.watch("defaultValue")}
            setValue={(v) => form.setValue("defaultValue", v)}
            valueType={valueType}
            // The feature doesn't exist yet, so scope the constant/config picker
            // to the selected project instead of passing a `feature`.
            project={selectedProject || undefined}
            constantContext={{ project: selectedProject || undefined }}
            useCodeInput={true}
            showFullscreenButton={true}
            // Config-backing is offered only for the "config" authoring type — a
            // plain JSON flag can't extend a config (any manual `@config:` in its
            // value is stripped on submit).
            allowConfigBacking={configType}
            // "config" type: the mainline picker chose the base; the default is
            // exactly a config in that family — the base itself, or a descendant
            // picked here. No inline overrides (config selection only), so no
            // patch editor (configBackingShowPatch stays false).
            configBackingOptionKeys={
              configType && baseConfigKey
                ? getConfigSubtree(baseConfigKey, configs)
                : undefined
            }
            lockConfigBacking={configType}
          />
        )}

        <Box className="appbox bg-light" px="4" pt="4" pb="1" mb="3">
          <EnvironmentSelect
            environmentSettings={environmentSettings}
            environments={environments}
            project={selectedProject}
            setValue={(env, on) => {
              environmentSettings[env.id].enabled = on;
              form.setValue("environmentSettings", environmentSettings);
            }}
          />
        </Box>

        {hasCommercialFeature("custom-metadata") &&
          customFields &&
          customFields?.length > 0 && (
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

        <Flex direction="column" mt="3">
          {showTags && (
            <TagsField
              value={form.watch("tags") || []}
              onChange={(tags) => form.setValue("tags", tags)}
              autoFocus={!defaultValues.tags?.length}
            />
          )}
          {showDescription && (
            <div className="form-group" style={{ width: "100%" }}>
              <label>Description</label>
              <Box mt="1">
                <MarkdownInput
                  value={form.watch("description") || ""}
                  setValue={(description) =>
                    form.setValue("description", description)
                  }
                  autofocus={!defaultValues.description?.length}
                />
              </Box>
            </div>
          )}

          <Flex gap="4">
            {!showTags && <Link onClick={() => setShowTags(true)}>+ tags</Link>}
            {!showDescription && (
              <Link onClick={() => setShowDescription(true)}>
                + description
              </Link>
            )}
          </Flex>
        </Flex>
      </FormProvider>
    </Modal>
  );
}
