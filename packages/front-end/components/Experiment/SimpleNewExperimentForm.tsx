import { ChangeEvent, FC, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/router";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { getEqualWeights } from "shared/experiments";
import {
  resolveAnalysisIdentifierType,
  getExposureQueryIdentifierTypes,
  getManagedWarehouseExposureQueryIdForAttribute,
  isProjectListValidForProject,
} from "shared/util";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import {
  PiInfo,
  PiPaperclip,
  PiPencilSimple,
  PiSparkle,
  PiX,
} from "react-icons/pi";
import Modal from "@/ui/Modal";
import ModalForm, { useModalForm } from "@/ui/Modal/ModalForm";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import RadioCards from "@/ui/RadioCards";
import Tooltip from "@/ui/Tooltip";
import { useToast } from "@/ui/Toast";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import { HoldoutSelect } from "@/components/Holdout/HoldoutSelect";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import {
  formatAttributeOptionLabel,
  toAttributeOption,
} from "@/components/Features/AttributeOptionTooltip";
import HelperText from "@/ui/HelperText";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  getDefaultIdentifierTypeForQuery,
  getHashAttributeIdentifierTypeMap,
} from "@/services/datasources";
import { useUser } from "@/services/UserContext";
import { useWatching } from "@/services/WatchProvider";
import { convertTemplateToExperiment } from "@/services/experiments";
import { useAttributeSchema } from "@/services/features";
import useOrgSettings, { useAISettings } from "@/hooks/useOrgSettings";
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
import Text from "@/ui/Text";
import {
  DeliveryMethod,
  storeExperimentDeliveryType,
  storeManagedValuesConfig,
} from "@/components/Experiment/TabbedPage/ManagedValuesContext";
import { DeliveryTypeSelect } from "@/components/Experiment/TabbedPage/ManagedValuesDelivery";
import {
  storeAiSetupDuration,
  storeAiSetupSpec,
} from "@/components/Experiment/TabbedPage/SetupPage/aiSetupFixture";
import {
  PlanDiagnostics,
  planFromFixture,
  planFromModel,
  SetupPlan,
} from "@/components/Experiment/TabbedPage/SetupPage/aiSetupPlan";
import { isDevelopmentEnvironment } from "@/services/env";
import styles from "./SimpleNewExperimentForm.module.scss";

// How the rest of the experiment is set up (prototype; set in review). "blank"
// is today's form; "ai" takes a description or a spec instead and fills the
// draft from the model's reading of it, or a fixed fixture if that fails
// (see aiSetupPlan.ts).
type SetupMode = "blank" | "ai";

// "Set up with AI" waits about a second before creating, with the button in
// its loading state, so it reads as work happening.
const AI_SETUP_DELAY_MS = 1000;
// The model gets this long, then the fixture is used instead (dev builds;
// production shows a timeout error).
const AI_SETUP_TIMEOUT_MS = 6000;

// DEV ONLY: logs one console.debug line per Create & Set Up, in development
// only, saying whether the model or the fixture filled the draft, why, and
// the model call's round trip. Set to false (or delete it and its one use) to
// remove before the demo.
const DEBUG_AI_SETUP = true;

// What asking the model came to. reason says why it fell back to the fixture
// (null when the model's plan was used); issues lists the fields it was
// missing or that were rejected; ms is the model call's round trip.
// Production builds: why Set up with AI failed, by ModelPlanOutcome.reason,
// in place of the dev-only fixture. Not the raw message: a provider's can
// quote part of a key.
const AI_SETUP_FAILURE_MESSAGES: Record<string, string> = {
  "AI disabled": "AI is not enabled for your organization.",
  "no key": "AI is not configured: no API key is set.",
  timeout: "The AI took too long to respond. Please try again.",
  "network error": "Couldn't reach the AI service. Please try again.",
  "malformed JSON":
    "The AI's response couldn't be read. Please try again, or start blank.",
  "missing core (hypothesis)":
    "The AI couldn't produce a plan from this description. Add more detail, or start blank.",
};

type ModelPlanOutcome = {
  plan: SetupPlan | null;
  reason: string | null;
  issues: string[];
  ms: number | null;
};

// The submit button: ModalStandard's (same Button, loading from the
// enclosing ModalForm), plus an optional icon. The modal is composed from
// @/ui/Modal's parts so the button can carry the sparkle; ModalStandard's
// cta is text only.
function SubmitButton({
  cta,
  icon,
  enabled,
}: {
  cta: string;
  icon?: React.ReactNode;
  enabled: boolean;
}) {
  const { loading } = useModalForm();
  return (
    <Button type="submit" disabled={!enabled} loading={loading} icon={icon}>
      {cta}
    </Button>
  );
}

// The form's labels, with the Stats Engine label's treatment (set in
// review): 12px at weight 500, in the inherited text colour, 4px above the
// control. The legacy Field/SelectField wrap a label in a <label> of their
// own at weight 600; this sets the size and weight on the text inside, and
// LABEL_CLASS (Bootstrap's mb-1) sets the 4px in place of Bootstrap's 8px
// label margin.
function FormLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text size="sm" weight="medium">
      {children}
    </Text>
  );
}
const LABEL_CLASS = "mb-1";

// Assignment Attribute's description, shown in its label's info tooltip.
const ASSIGNMENT_ATTRIBUTE_INFO =
  "Will be hashed together with the Tracking Key to determine which variation to assign";

// The setup choice cards' subtitles sit 4px closer to their titles (set in
// review): RadioCards spaces them 4px apart (gap="1") and has no prop for
// it, so each subtitle is pulled up by that 4px, leaving none.
const CARD_SUBTITLE_PULL = -4;
// The subtitles in --slate-11, as "Describe your Experiment"'s description
// (set in review). Off the text tokens, so set on the wrapper and Text
// inherits it.
const CARD_SUBTITLE_COLOR = "var(--slate-11)";

// The small rounded icon tile at the left of each setup choice card: the
// accent's soft fill (--violet-a3) and text (--violet-11). Composed: there's
// no icon-tile component in @/ui/.
function ChoiceIcon({ children }: { children: React.ReactNode }) {
  return (
    <Flex
      align="center"
      justify="center"
      flexShrink="0"
      aria-hidden
      style={{
        width: 32,
        height: 32,
        borderRadius: "var(--radius-3)",
        backgroundColor: "var(--violet-a3)",
        color: "var(--violet-11)",
      }}
    >
      {children}
    </Flex>
  );
}

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
      getExposureQueryIdentifierTypes(q).some((identifierType) =>
        linkedUserIdTypes.includes(identifierType),
      ),
    );
    if (matchingQueries.length === 1) return matchingQueries[0].id;
  }
  return "";
}

/**
 * A template's assignment selection, kept when its query still declares the
 * identifier and otherwise moved to one that does, since a different
 * identifier would measure different units. "unavailable" when no query
 * declares it, so the experiment is created without assignment settings. Null
 * when the template has no selection to honor.
 */
export function resolveTemplateAssignment({
  datasource,
  templateExposureQueryId,
  templateIdentifierType,
}: {
  datasource?: DataSourceInterfaceWithParams;
  templateExposureQueryId?: string;
  templateIdentifierType?: string;
}):
  | { kind: "selected"; exposureQueryId: string; identifierType: string }
  | { kind: "unavailable"; identifierType: string }
  | null {
  const queries = datasource?.settings?.queries?.exposure ?? [];
  const templateQuery = queries.find((q) => q.id === templateExposureQueryId);
  if (!templateQuery) return null;
  const identifierType = resolveAnalysisIdentifierType(
    templateQuery,
    templateIdentifierType,
  );
  if (!identifierType) return null;
  const query = [templateQuery, ...queries].find((q) =>
    getExposureQueryIdentifierTypes(q).includes(identifierType),
  );
  return query
    ? { kind: "selected", exposureQueryId: query.id, identifierType }
    : { kind: "unavailable", identifierType };
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
    metrics,
    factMetrics,
  } = useDefinitions();
  const { hasCommercialFeature } = useUser();
  const settings = useOrgSettings();
  const { aiEnabled } = useAISettings();
  const toast = useToast();
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

  const [setupMode, setSetupMode] = useState<SetupMode>("blank");
  const [aiDescription, setAiDescription] = useState("");
  // The attached spec, read as text when attached and sent to the model with
  // the description. One at most (set in review): with two, nothing could
  // say which wins when they disagree on a field. Attaching another
  // replaces it. A list of zero or one, as the route takes. Capped at the
  // route's 100,000 characters.
  const [aiFiles, setAiFiles] = useState<{ name: string; content: string }[]>(
    [],
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Attach .md shows only while no file is attached (set in review). When
  // the chip's remove takes the last file away, focus goes back to the
  // button that reappears, rather than to the page.
  const attachButtonRef = useRef<HTMLButtonElement>(null);
  const focusAttachOnReturn = useRef(false);
  useEffect(() => {
    if (!aiFiles.length && focusAttachOnReturn.current) {
      focusAttachOnReturn.current = false;
      attachButtonRef.current?.focus();
    }
  }, [aiFiles]);
  const settingUpWithAI = setupMode === "ai";
  // Switching options shouldn't resize the modal (set in review). Start
  // blank's fields usually fill it to its max height (85% of the window);
  // Set up with AI's are shorter, so the modal shrank. On the switch, the
  // body's height is measured and Set up with AI's fields get it as a
  // minimum, so the modal holds its height and the spare room sits below
  // them.
  const fieldsRef = useRef<HTMLDivElement>(null);
  const [aiMinHeight, setAiMinHeight] = useState<number | null>(null);
  const chooseSetupMode = (mode: SetupMode) => {
    const fields = fieldsRef.current;
    const viewport = fields?.closest<HTMLElement>(
      "[data-radix-scroll-area-viewport]",
    );
    if (mode === "ai" && setupMode === "blank" && fields && viewport) {
      // The body's visible height, less what else sits in it (its padding,
      // an error), is what the fields can fill without a scrollbar.
      const other = viewport.scrollHeight - fields.offsetHeight;
      setAiMinHeight(viewport.clientHeight - other);
    }
    setSetupMode(mode);
  };
  const onAttach = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Cleared so the same file can be attached again after removing it.
    e.target.value = "";
    if (!file) return;
    const content = (await file.text().catch(() => "")).slice(0, 100000);
    // Replaces any file already attached.
    setAiFiles([{ name: file.name, content }]);
  };

  const initialAttributeSchema = useAttributeSchema(false, initialProject);
  const initialHashAttributes = initialAttributeSchema
    .filter((a) => a.hashAttribute)
    .map((a) => a.property);
  const initialHashAttribute =
    initialHashAttributes.length === 1 ? initialHashAttributes[0] : "";

  // experimentDeliveryType is prototype-only and never sent to the API: the
  // create payload below is built field by field, and this isn't one of them.
  const form = useForm<
    Partial<ExperimentInterfaceStringDates> & {
      experimentDeliveryType: DeliveryMethod;
    }
  >({
    defaultValues: {
      project: initialProject,
      name: "",
      trackingKey: "",
      hypothesis: "",
      hashAttribute: initialHashAttribute,
      templateId: "",
      holdoutId: undefined,
      customFields: undefined,
      experimentDeliveryType: "values",
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
  const hashAttributes = attributeSchema
    .filter((a) => a.hashAttribute)
    .map((a) => a.property);
  const hasHashAttributes = hashAttributes.length > 0;
  const defaultHashAttribute =
    hashAttributes.length === 1 ? hashAttributes[0] : "";

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

  const canSubmit =
    hasProjectPermission &&
    !sdkConnectionsLoading &&
    // Set up with AI needs something to go on: a description or a file.
    (!settingUpWithAI || aiDescription.trim() !== "" || aiFiles.length > 0);

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
  const unavailableTemplateAssignment = watchedTemplate
    ? resolveTemplateAssignment({
        datasource: autoDatasource ?? undefined,
        templateExposureQueryId: watchedTemplate.exposureQueryId,
        templateIdentifierType: watchedTemplate.exposureQueryIdentifierType,
      })
    : null;
  const showLinkIdentifierCallout =
    !!autoDatasource &&
    autoDatasource.type !== "growthbook_clickhouse" &&
    permissionsUtil.canUpdateDataSourceSettings(autoDatasource) &&
    autoDsExposureQueries.length > 0 &&
    !hashAttributeLinkedToIdentifier &&
    !wouldAutoSelectExposureQuery;

  // Asks the model to read the description and files (POST
  // /ai/experiment-setup). Resolves to its plan, or null on ANY failure (AI
  // off, no key, network, a 6-second timeout, a malformed or too-thin
  // answer), silently: the caller then uses the fixture (dev builds) or
  // shows why (production). When the org's AI
  // is off it doesn't call at all, so the browser doesn't log a failed
  // request.
  const requestModelPlan = async (
    project: string,
    candidates: { id: string; name: string }[],
  ): Promise<ModelPlanOutcome> => {
    const outcome: ModelPlanOutcome = {
      plan: null,
      reason: null,
      issues: [],
      ms: null,
    };
    if (!aiEnabled) {
      outcome.reason = settings.aiEnabled ? "no key" : "AI disabled";
      return outcome;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<ModelPlanOutcome>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ ...outcome, reason: "timeout", ms: AI_SETUP_TIMEOUT_MS });
      }, AI_SETUP_TIMEOUT_MS);
    });
    const call = (async (): Promise<ModelPlanOutcome> => {
      const started = performance.now();
      try {
        const res = await apiCall<{ data?: unknown }>("/ai/experiment-setup", {
          method: "POST",
          body: JSON.stringify({
            project,
            description: aiDescription,
            files: aiFiles,
            attributes: attributeSchema.map((a) => a.property),
            metrics: candidates.map((m) => ({ id: m.id, name: m.name })),
          }),
          signal: controller.signal,
        });
        const ms = Math.round(performance.now() - started);
        const diagnostics: PlanDiagnostics = {
          malformed: false,
          missingCore: false,
          issues: [],
        };
        const plan = planFromModel(
          res?.data,
          {
            attributes: attributeSchema.map((a) => a.property),
            metricIds: candidates.map((m) => m.id),
          },
          diagnostics,
        );
        return {
          plan,
          reason: plan
            ? null
            : diagnostics.malformed
              ? "malformed JSON"
              : "missing core (hypothesis)",
          issues: diagnostics.issues,
          ms,
        };
      } catch (e) {
        const ms = Math.round(performance.now() - started);
        const message = e instanceof Error ? e.message : "";
        return {
          ...outcome,
          ms,
          reason:
            e instanceof TypeError
              ? "network error"
              : /API_KEY is not set/.test(message)
                ? "no key"
                : /not set or enabled|not enabled/i.test(message)
                  ? "AI disabled"
                  : /expected format/.test(message)
                    ? "malformed JSON"
                    : // Not the raw message: a provider's can quote part
                      // of a key.
                      "other error",
        };
      }
    })();
    try {
      return await Promise.race([call, timeout]);
    } finally {
      clearTimeout(timer);
    }
  };

  const onSubmit = form.handleSubmit(async (rawValue) => {
    const name = (rawValue.name || "").trim();
    if (name.length < 1) {
      throw new Error("Name must not be empty");
    }
    if (!settingUpWithAI && templateRequired && !rawValue.templateId) {
      throw new Error("You must select a template");
    }

    let data: Partial<ExperimentInterfaceStringDates>;
    // Set up with AI never uses a template: its fields are hidden, and its
    // plan fills the draft.
    const templateId = settingUpWithAI ? "" : rawValue.templateId || "";
    const template = templateId ? templatesMap.get(templateId) : undefined;

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
    // Set up with AI hides Assignment Attribute: it keeps the form's default,
    // falling back to the first hash attribute, then "id".
    const hashAttribute = settingUpWithAI
      ? rawValue.hashAttribute || hashAttributes[0] || "id"
      : rawValue.hashAttribute;
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

    // Set up with AI's plan: the model's reading of the description and
    // files, or, on any failure, the fixed fixture in dev builds (an error
    // in production), never a mix (see
    // aiSetupPlan.ts). Its goal metric must be one the org has, on the
    // experiment's data source when it has one (the API requires that), in
    // the project. Takes at least AI_SETUP_DELAY_MS, so it reads as work.
    let aiPlan: SetupPlan | null = null;
    if (settingUpWithAI) {
      const candidates = [...metrics, ...factMetrics].filter(
        (m) =>
          (!datasourceId || m.datasource === datasourceId) &&
          isProjectListValidForProject(m.projects, project),
      );
      const [outcome] = await Promise.all([
        requestModelPlan(project, candidates),
        new Promise((resolve) => setTimeout(resolve, AI_SETUP_DELAY_MS)),
      ]);
      if (outcome.plan) {
        aiPlan = outcome.plan;
      } else if (isDevelopmentEnvironment()) {
        // PROTOTYPE ONLY: dev builds fall back to the demo fixture (see
        // aiSetupFixture.ts) so a demo can't misbehave. Production builds
        // never use it: they show the real failure below.
        aiPlan = planFromFixture({
          attributes: attributeSchema.map((a) => a.property),
          metrics: candidates,
        });
      } else {
        throw new Error(
          AI_SETUP_FAILURE_MESSAGES[outcome.reason ?? ""] ??
            "Set up with AI failed. Please try again, or start blank.",
        );
      }
      // Dev-only diagnostic: which source filled the draft and why. Delete
      // this block and DEBUG_AI_SETUP to remove it.
      if (DEBUG_AI_SETUP && isDevelopmentEnvironment()) {
        console.debug(
          `[AI setup] ${outcome.plan ? "model" : `fixture — ${outcome.reason}`}` +
            (outcome.issues.length ? ` — ${outcome.issues.join("; ")}` : "") +
            (outcome.ms !== null ? ` — ${outcome.ms}ms` : ""),
        );
      }
      // The plan sets how many variations there are, and their names and
      // descriptions where it has them (the defaults otherwise).
      const planned = aiPlan.variations;
      const variations = getDefaultVariations(planned.length).map((v, i) => ({
        ...v,
        name: planned[i]?.name ?? v.name,
        description: planned[i]?.description || v.description,
      }));
      data.variations = variations;
      data.phases = data.phases?.map((phase) => ({
        ...phase,
        condition: aiPlan?.condition ?? "",
        coverage: aiPlan?.coverage ?? 1,
        variationWeights: aiPlan?.variationWeights ?? [],
        variations: variations.map((v) => ({
          id: v.id,
          status: "active" as const,
        })),
      }));
    }

    data = {
      ...data,
      type: "standard",
      status: "draft",
      project,
      name,
      hypothesis: aiPlan ? aiPlan.hypothesis : rawValue.hypothesis || "",
      ...(aiPlan?.description ? { description: aiPlan.description } : {}),
      ...(aiPlan?.goalMetricId ? { goalMetrics: [aiPlan.goalMetricId] } : {}),
      ...(aiPlan?.secondaryMetrics.length
        ? { secondaryMetrics: aiPlan.secondaryMetrics }
        : {}),
      ...(aiPlan?.guardrailMetrics.length
        ? { guardrailMetrics: aiPlan.guardrailMetrics }
        : {}),
      hashAttribute,
      hashVersion,
      datasource: datasourceId,
      exposureQueryId,
      exposureQueryIdentifierType,
      templateId,
      holdoutId: settingUpWithAI ? undefined : rawValue.holdoutId || undefined,
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

    // Prototype-only — not part of the create payload above (no back-end or
    // schema changes). Written here, once, because no ExperimentTypeProvider
    // exists for the new experiment until its page loads. See
    // ManagedValuesContext.tsx.
    storeExperimentDeliveryType(
      res.experiment.id,
      aiPlan ? aiPlan.deliveryType : rawValue.experimentDeliveryType,
    );
    // Duration has no product field; the Setup page reads it from here.
    if (aiPlan?.duration) {
      storeAiSetupDuration(res.experiment.id, aiPlan.duration);
    }
    // The attached spec, name and text as-is, for the Details rail's Spec
    // row: a snapshot of what the experiment was built from. Only when a
    // file was attached, whichever source filled the draft.
    if (settingUpWithAI && aiFiles[0]) {
      storeAiSetupSpec(res.experiment.id, aiFiles[0]);
    }
    // Values the input stated, kept in this browser as the Setup page keeps
    // them (ManagedValuesContext). Unstated ones stay blank, so Set
    // Variation Values stays on the To Do list until they're all in.
    if (aiPlan?.values) {
      const { dataType, byIndex } = aiPlan.values;
      storeManagedValuesConfig(res.experiment.id, {
        dataType,
        key: res.experiment.trackingKey,
        valuesByVariationId: Object.fromEntries(
          res.experiment.variations.flatMap((v, i) =>
            byIndex[i] !== null && byIndex[i] !== undefined
              ? [[v.id, byIndex[i]]]
              : [],
          ),
        ),
      });
    }
    // A scheduled start: the create endpoint doesn't take one, so it's set
    // with the same update the Setup page's Timing saves. If that fails, the
    // draft just starts manually, as if none was stated.
    if (aiPlan?.scheduledStart) {
      await apiCall(`/experiment/${res.experiment.id}`, {
        method: "POST",
        body: JSON.stringify({
          statusUpdateSchedule: { startAt: aiPlan.scheduledStart },
        }),
      }).catch(() => undefined);
    }

    track("Create Experiment: Simple Flow", {
      source,
      createdFromTemplate: !!data.templateId,
    });
    refreshWatching();
    if (data.templateId) refreshTemplates();

    // A confirmation (set in review), with the app's toast as it is: its
    // default status, position and 4-second duration. The toasts live in
    // _app, above every page, so this one carries over to the experiment
    // page. Set up with AI says the same thing whether the model or the
    // fixture filled the draft.
    toast(
      settingUpWithAI ? "Experiment created and set up" : "Experiment created",
    );
    router.push(`/experiment/${res.experiment.id}`);
  });

  // Composed from @/ui/Modal's parts the way ModalStandard builds its modal
  // (same header, body, footer, form, Cancel, and not dismissible), so the
  // submit button can carry an icon for Set up with AI.
  return (
    <Modal.Root
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose?.();
      }}
      size="lg"
      dismissible={false}
      hasDescription={false}
      trackingEventModalType="simple-new-experiment-create"
      trackingEventModalSource={source}
    >
      <ModalForm
        onSubmit={async () => {
          await onSubmit();
          onClose?.();
        }}
      >
        <Modal.Header>
          <Modal.Title>Create Experiment</Modal.Title>
          {onSwitchToLegacy && showSwitchToOldExpCreate ? (
            <Box>
              <Link onClick={onSwitchToLegacy} color="gray">
                Switch to old experience
              </Link>
            </Box>
          ) : null}
        </Modal.Header>
        <Modal.Body>
          {/* Every field gets the Setup page's hover outline (set in
            review; see SimpleNewExperimentForm.module.scss). */}
          <Box
            ref={fieldsRef}
            className={styles.fields}
            style={
              settingUpWithAI && aiMinHeight !== null
                ? { minHeight: aiMinHeight }
                : undefined
            }
          >
            <Flex direction="column" gap="4" mb="4">
              {showSwitchToOldExpCreate && (
                <Callout
                  status="info"
                  dismissible
                  id="new-experiment-create-flow-callout"
                >
                  Other experiment configuration steps now live on the
                  experiment overview page.
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
              label={<FormLabel>Experiment Name</FormLabel>}
              labelClassName={LABEL_CLASS}
              // The form's "e.g." placeholder style, sentence case, matching
              // the Hypothesis example (set in review).
              placeholder="e.g. Bigger signup button"
              required
              minLength={2}
              {...form.register("name")}
            />
            {settings.experimentKeyRegexValidator && (
              <Field
                label={<FormLabel>Tracking Key</FormLabel>}
                labelClassName={LABEL_CLASS}
                {...form.register("trackingKey")}
                {...trackingKeyFormatProps}
              />
            )}

            {projects.length >= 1 && (
              <SelectField
                label={<FormLabel>Project</FormLabel>}
                labelClassName={LABEL_CLASS}
                value={selectedProject}
                onChange={(p) => form.setValue("project", p)}
                name="project"
                initialOption={allowAllProjects ? "All Projects" : undefined}
                options={availableProjects}
              />
            )}

            {!hasProjectPermission && (
              <Callout status="error" mb="3">
                You don&apos;t have permission to create experiments in this
                project.
              </Callout>
            )}

            {/* How to set up the rest (set in review). A <fieldset> whose
        <legend> is the question, holding @/ui/RadioCards: the codebase's
        selectable-card pattern (Radix radio cards: a radiogroup of
        role="radio" items with arrow-key selection), two columns. Start
        blank is the default, so today's flow is unchanged. */}
            <fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
              {/* In normal flow (fixed in review): floated, it pushed the
              cards' grid, which can't overlap a float, into the zero-width
              gap beside it. */}
              <legend style={{ padding: 0 }}>
                <FormLabel>
                  How do you want to set up your experiment?
                </FormLabel>
              </legend>
              <RadioCards
                columns="2"
                width="100%"
                // Directly below the question, no gap (set in review; it was
                // 8px, then 4px, then 2px).
                align="center"
                labelSize="md"
                truncateDescription={false}
                value={setupMode}
                setValue={(v) => chooseSetupMode(v as SetupMode)}
                mb="4"
                options={[
                  {
                    value: "blank",
                    label: "Start blank",
                    description: (
                      <Box
                        style={{
                          marginTop: CARD_SUBTITLE_PULL,
                          color: CARD_SUBTITLE_COLOR,
                        }}
                      >
                        <Text size="sm">Fill in the fields yourself</Text>
                      </Box>
                    ),
                    avatar: (
                      <ChoiceIcon>
                        <PiPencilSimple size={16} />
                      </ChoiceIcon>
                    ),
                  },
                  {
                    value: "ai",
                    label: "Set up with AI",
                    description: (
                      <Box
                        style={{
                          marginTop: CARD_SUBTITLE_PULL,
                          color: CARD_SUBTITLE_COLOR,
                        }}
                      >
                        <Text size="sm">Describe it or attach a spec</Text>
                      </Box>
                    ),
                    avatar: (
                      <ChoiceIcon>
                        <PiSparkle size={16} />
                      </ChoiceIcon>
                    ),
                  },
                ]}
              />
            </fieldset>

            {settingUpWithAI ? (
              <>
                {/* The label and its helper text as Assignment Attribute's are
            (a semibold line over a muted one). Legacy Field's textarea, as
            Hypothesis uses: FALLBACK, @/ui/ has no textarea. Five rows to
            start; it grows with the text and can be dragged taller. */}
                <Field
                  label={
                    // 2px between the label and its description (off the
                    // space scale), and 8px from the description to the
                    // text area (Bootstrap's mb-2 on the label); set in
                    // review.
                    <>
                      <Box style={{ marginBottom: 2 }}>
                        <FormLabel>Describe your Experiment</FormLabel>
                      </Box>
                      {/* --slate-11 (set in review). Off the text tokens
                        (Text's color prop only takes those), so it's set on
                        a wrapper that Text inherits from. */}
                      <Box style={{ color: "var(--slate-11)" }}>
                        <Text as="div">
                          Paste a description or attach a spec. AI fills in what
                          your spec covers, you confirm the rest.
                        </Text>
                      </Box>
                    </>
                  }
                  labelClassName="mb-2"
                  textarea
                  minRows={5}
                  style={{ resize: "vertical" }}
                  value={aiDescription}
                  onChange={(e) => setAiDescription(e.target.value)}
                />
                {/* Attach: a button that opens a hidden file input, the pattern
            FileInput uses (its own field-style trigger doesn't fit chips).
            Attached files show as removable chips: Badge with a PiX
            IconButton, the experiment filters' chip. Not parsed. */}
                <Flex direction="column" gap="2" mb="3">
                  {/* display: none, so it takes no room (or gap) in the
                    column. */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".md,text/markdown"
                    onChange={onAttach}
                    style={{ display: "none" }}
                    tabIndex={-1}
                    aria-hidden
                  />
                  {/* Hidden while a file is attached: its chip, with the
                    remove control, is then the only control, in the
                    button's place. */}
                  {!aiFiles.length ? (
                    <Box>
                      <Button
                        ref={attachButtonRef}
                        variant="outline"
                        size="md"
                        icon={<PiPaperclip />}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        Attach .md
                      </Button>
                    </Box>
                  ) : null}
                  {aiFiles.length ? (
                    // The attached file under its own label (set in review),
                    // styled as the form's other labels (FormLabel: 12px,
                    // weight 500), 4px above the chip.
                    <Box>
                      <Box mb="1">
                        <FormLabel>Attached Spec</FormLabel>
                      </Box>
                      <Flex gap="2" wrap="wrap">
                        {aiFiles.map(({ name }) => (
                          <Badge
                            key={name}
                            // One size up from the default sm, in our neutral
                            // badge colours, gray and soft (both set in review).
                            size="md"
                            color="gray"
                            variant="soft"
                            radius="small"
                            style={{ maxWidth: "100%", whiteSpace: "normal" }}
                            label={
                              <Flex align="center" gap="1">
                                <Text
                                  size="sm"
                                  whiteSpace="normal"
                                  weight="medium"
                                  overflowWrap="anywhere"
                                >
                                  {name}
                                </Text>
                                <IconButton
                                  size="1"
                                  variant="ghost"
                                  color="gray"
                                  radius="full"
                                  aria-label={`Remove ${name}`}
                                  onClick={() => {
                                    focusAttachOnReturn.current = true;
                                    setAiFiles((prev) =>
                                      prev.filter((f) => f.name !== name),
                                    );
                                  }}
                                >
                                  <PiX size={12} />
                                </IconButton>
                              </Flex>
                            }
                          />
                        ))}
                      </Flex>
                    </Box>
                  ) : null}
                </Flex>
              </>
            ) : (
              <>
                {hasCommercialFeature("templates") &&
                  availableTemplates.length >= 1 && (
                    <SelectField
                      label={
                        <PremiumTooltip commercialFeature="templates">
                          <FormLabel>Template</FormLabel>
                        </PremiumTooltip>
                      }
                      labelClassName={LABEL_CLASS}
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
                        const templateAsExperiment =
                          convertTemplateToExperiment(template);
                        if (templateAsExperiment.hypothesis) {
                          form.setValue(
                            "hypothesis",
                            templateAsExperiment.hypothesis,
                          );
                        }
                        if (templateAsExperiment.hashAttribute) {
                          form.setValue(
                            "hashAttribute",
                            templateAsExperiment.hashAttribute,
                          );
                        }
                        form.setValue(
                          "customFields",
                          templateAsExperiment.customFields,
                        );
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

                {/* Prototype-only delivery type. See ManagedValuesContext.tsx. After
        Template and before Holdout (set in review). */}
                <DeliveryTypeSelect
                  label="Experiment Type"
                  value={form.watch("experimentDeliveryType")}
                  setValue={(v) => form.setValue("experimentDeliveryType", v)}
                />

                <HoldoutSelect
                  selectedProject={selectedProject}
                  selectedHoldoutId={form.watch("holdoutId")}
                  setHoldout={(holdoutId) =>
                    form.setValue("holdoutId", holdoutId)
                  }
                  formType="experiment"
                  label={<FormLabel>Holdout</FormLabel>}
                  labelClassName={LABEL_CLASS}
                />

                <Field
                  label={<FormLabel>Hypothesis</FormLabel>}
                  labelClassName={LABEL_CLASS}
                  textarea
                  minRows={2}
                  placeholder="e.g. Making the signup button bigger will increase clicks and ultimately improve revenue"
                  {...form.register("hypothesis")}
                />

                <SelectField
                  required
                  // The description moved into an info tooltip right of the
                  // label (set in review), as the Setup page's Activation
                  // Metric and Variation IDs labels have theirs.
                  label={
                    <Flex
                      as="span"
                      display="inline-flex"
                      align="center"
                      gap="1"
                    >
                      <FormLabel>Assignment Attribute</FormLabel>
                      <Tooltip content={ASSIGNMENT_ATTRIBUTE_INFO}>
                        <span
                          className={styles.infoIcon}
                          aria-label={ASSIGNMENT_ATTRIBUTE_INFO}
                        >
                          <PiInfo size={12} aria-hidden />
                        </span>
                      </Tooltip>
                    </Flex>
                  }
                  labelClassName={LABEL_CLASS}
                  className={
                    hashAttributeHoldoutMismatch ? "warning" : undefined
                  }
                  value={form.watch("hashAttribute") ?? ""}
                  onChange={(v) => form.setValue("hashAttribute", v)}
                  options={attributeSchema
                    .filter((s) => !hasHashAttributes || s.hashAttribute)
                    .map(toAttributeOption)}
                  formatOptionLabel={formatAttributeOptionLabel}
                  helpText={
                    hashAttributeHoldoutMismatch ? (
                      <HelperText status="warning" size="sm" mt="2">
                        The hash attribute of this experiment does not match the
                        hash attribute of the holdout this experiment will
                        belong to.
                      </HelperText>
                    ) : undefined
                  }
                />
                {unavailableTemplateAssignment?.kind === "unavailable" && (
                  <Callout status="warning" mb="3">
                    This template&apos;s identifier type (&quot;
                    {unavailableTemplateAssignment.identifierType}&quot;)
                    isn&apos;t declared by any assignment query. The experiment
                    will be created without assignment settings, so choose them
                    before analyzing results.
                  </Callout>
                )}
                {showLinkIdentifierCallout && autoDatasource && (
                  <Callout status="info" mb="3">
                    Link the <strong>{watchedHashAttribute}</strong> attribute
                    to an identifier type in{" "}
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
              </>
            )}

            {customFields.length > 0 && (
              <CustomFieldInput
                fields={customFields}
                value={customFieldValues}
                onChange={(value) => form.setValue("customFields", value)}
              />
            )}
          </Box>
        </Modal.Body>
        <Modal.Footer justify="end">
          <Flex gap="3" align="center">
            <Modal.Close>
              <Button variant="ghost" onClick={() => onClose?.()}>
                Cancel
              </Button>
            </Modal.Close>
            {settingUpWithAI ? (
              <SubmitButton
                cta="Create & Set Up"
                icon={<PiSparkle />}
                enabled={canSubmit}
              />
            ) : (
              <SubmitButton cta="Create" enabled={canSubmit} />
            )}
          </Flex>
        </Modal.Footer>
      </ModalForm>
    </Modal.Root>
  );
};

export default SimpleNewExperimentForm;
