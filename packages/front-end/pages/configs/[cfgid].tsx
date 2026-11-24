import clsx from "clsx";
import {
  archiveFootprintForControl,
  NO_ENVIRONMENT_BINDING,
  canCommentOnRevisionEntity,
  canDeleteArchivedEntity,
  canLandArchiveToggle,
  canLandRevertToTarget,
  canPublishRevisionEntity,
  canReviewRevisionEntity,
  holdsRevisionDestination,
  revisionPublishFootprint,
  serveFootprint,
} from "shared/permissions";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import { ConstantInterface } from "shared/types/constant";
import { ConfigInterface } from "shared/types/config";
import { CONSTANT_EXTENDS_KEY } from "shared/constants";
import { SchemaField, SimpleSchema } from "shared/types/feature";
import {
  Revision,
  applyTopLevelPatchOps,
  getConstantRevisionChange,
  getLiveRevision,
  getRevisionNumberById,
  isRevisionEditLockedBySchedule,
} from "shared/enterprise";
import { isActiveDraftStatus } from "shared/validators";
import {
  proposedArchivedValue,
  ConfigChainNode,
  SchemaProjection,
  computeConfigReconciliationPreview,
  configPublishEnvironments,
  constantRequiresReview,
  evaluateInvariants,
  fieldsToGolang,
  fieldsToProto,
  fieldsToPython,
  fieldsToRust,
  fieldsToTsType,
  collectConfigValueIssuesByKey,
  getConfigSubtree,
  getReviewSetting,
  invariantRuleFields,
  isScopedConfig,
  parsePlainJSONObject,
  resolveConfigChain,
  restoredProjectScope,
  simpleToJSONSchema,
} from "shared/util";
import {
  buildConstantValueMap,
  resolveConstantRefs,
  ConstantSource,
} from "shared/sdk-versioning";
import { isEqual } from "lodash";
import { Box, Flex, Separator } from "@radix-ui/themes";
import {
  PiPlus,
  PiCaretDown,
  PiCheck,
  PiCopy,
  PiLockSimple,
} from "react-icons/pi";
import useApi from "@/hooks/useApi";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import Button from "@/ui/Button";
import SegmentedControl from "@/ui/SegmentedControl";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useEnvironments } from "@/services/features";
import LoadingOverlay from "@/components/LoadingOverlay";
import PageHead from "@/components/Layout/PageHead";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import ArchiveStateCallout from "@/components/Revision/ArchiveStateCallout";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import MarkdownLinks from "@/components/Markdown/MarkdownLinks";
import HelperText from "@/ui/HelperText";
import ConfirmDialog from "@/ui/ConfirmDialog";
import { EDITS_BLOCKED_REASON } from "@/components/StagedEdits/StagedEditsBar";
import useUnsavedChangesGuard from "@/hooks/useUnsavedChangesGuard";
import { withViewTransition } from "@/services/viewTransition";
import ConfigJsonEditor from "@/components/Configs/ConfigJsonEditor";
import ConfigEnvTabs from "@/components/Configs/ConfigEnvTabs";
import SelectField from "@/components/Forms/SelectField";
import Switch from "@/ui/Switch";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownSubMenu,
} from "@/ui/DropdownMenu";
import RevisionDropdown from "@/components/Revision/RevisionDropdown";
import ReviewAndPublishTab from "@/components/Revision/ReviewAndPublishTab";
import CompareRevisionsModal from "@/components/Revision/CompareRevisionsModal";
import RevisionStatusBar, {
  hasRevisionStatus,
} from "@/components/Revision/RevisionStatusBar";
import { getStatusBadge } from "@/components/Revision/revisionUtils";
import RevisionLabel from "@/components/Reviews/RevisionLabel";
import NewDraftButton from "@/components/Reviews/NewDraftButton";
import { useRevisionStatusBarHeight } from "@/components/Reviews/RevisionStatusBarView";
import SectionFrame from "@/components/SectionFrame";
import DetailsPanel, {
  DetailsPanelLayout,
  PanelSection,
  useDetailsPanel,
} from "@/components/DetailsPanel";
import {
  DetailsPageActions,
  DetailsPageMenu,
  DetailsPageTabs,
  DetailsPageTitleBar,
  REVISION_SELECTOR_WIDTH_PX,
  ReviewTabCount,
} from "@/components/Layout/DetailsPageHeader";
import { useTabsBottom } from "@/components/Layout/pageTopOffset";
import ConfigDetailsPanel from "@/components/Configs/ConfigDetailsPanel";
import Tooltip from "@/ui/Tooltip";
import { SCHEDULE_EDIT_LOCK_REASON } from "@/components/Features/ScheduleLock";
import LabelWithHelp from "@/ui/LabelWithHelp";
import AuditHistoryExplorerModal from "@/components/AuditHistoryExplorer/AuditHistoryExplorerModal";
import { OVERFLOW_SECTION_LABEL } from "@/components/AuditHistoryExplorer/useAuditDiff";
import {
  REVISION_CONFIG_DIFF_CONFIG,
  renderConstantSettings,
  renderConstantValues,
  renderConstantSchema,
  getConstantSettingsBadges,
  getConstantValuesBadges,
  getConstantSchemaBadges,
} from "@/components/Constants/ConstantDiffRenders";
import { useConstantRevision } from "@/hooks/useConstantRevision";
import {
  useConfigFamilyReferences,
  useConfigKeyUsage,
  ConfigKeyImplementation,
} from "@/hooks/useConstantReferences";
import ConfigArchiveModal from "@/components/Configs/ConfigArchiveModal";
import ConfigLockModal from "@/components/Configs/ConfigLockModal";
import ConfigRevertModal from "@/components/Configs/ConfigRevertModal";
import { ConstantRevisionContext } from "@/components/Constants/useConstantDraftTarget";
import ConfigModal from "@/components/Configs/ConfigModal";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import LineageTree from "@/components/Configs/LineageTree";
import {
  DescendantImpactCallout,
  FamilyRuleFailuresCallout,
  ReconciledFieldsCallout,
  reconciledFieldNotice,
  schemaIssuesNotice,
  undeclaredKeysNotice,
} from "@/components/Configs/ConfigKeyNotices";
import ConfigFeatureReferences from "@/components/Configs/ConfigFeatureReferences";
import { TabsTrigger } from "@/ui/Tabs";
import FieldDefForm from "@/components/Configs/FieldDefForm";
import ConfigFieldRow, {
  fieldsTableClassName,
  FieldRowMenu,
  menuColumnHiddenClassName,
} from "@/components/Configs/ConfigFieldRow";
import ConfigInvariantsEditor, {
  InheritedInvariant,
  RuleRequest,
  RulesEditorHandle,
} from "@/components/Configs/ConfigInvariantsEditor";
import LinkButton from "@/ui/LinkButton";
import ConfigCustomHooksSection from "@/components/Configs/ConfigCustomHooksSection";
import ConfigUsageSection from "@/components/Configs/ConfigUsageSection";
import {
  ResolvedField,
  parseFieldValueInput,
  LineageNode,
  blankField,
  valueEditSeed,
  ValueEditSeed,
  configRelation,
  SCHEMA_LANG_LABEL,
} from "@/components/Configs/fieldSchema";

type ResolvedResponse = {
  status: number;
  config: ConfigInterface;
  // Re-resolved client-side so a selected draft's proposed value shows in the field table.
  chain: ConfigChainNode[];
  effectiveSchema: SchemaField[];
  extensible?: boolean;
  fields: ResolvedField[];
  lineage: LineageNode[];
  // Families that compose this config as a mixin, one per composing spine family,
  // so a mixin view can render "where am I used" as N trees. Keyed by spine root.
  composerFamilies?: { rootKey: string; lineage: LineageNode[] }[];
  fieldCounts?: Record<string, number>;
  configNames?: Record<string, string>;
  archivedByKey?: Record<string, boolean>;
  draftByKey?: Record<string, boolean>;
  // The editor and JSON view keep references raw; this drives `@const:` squashing in the table.
  constants: (Pick<
    ConstantInterface,
    "key" | "type" | "value" | "project" | "archived"
  > & { source: ConstantSource })[];
};

const LINEAGE_PANEL_WIDTH_PX = 280;
const REVISION_QUERY = ["v"];

// An edit started from live, picked up once the draft it goes to is showing.
type LiveEdit =
  | {
      kind:
        | "value"
        | "field"
        | "removeField"
        | "removeOverride"
        | "removeMixin";
      key: string;
    }
  | { kind: "addField" | "addMixin" | "json" }
  | { kind: "rule"; rule: RuleRequest };
const FIELDS_TABLE_MIN_WIDTH_PX = 850;
// The Fields card and page padding around the table. The details rail floats
// before the table would have to scroll beside it.
const FIELDS_TABLE_CHROME_PX = 100;
// Two usage badges side by side (a two-digit count and its dots each), and at
// least its header's width, so it renders at exactly this.
const USAGE_COLUMN_PX = 136;
// The Copy menu's value items share a height: a label and one line under it.
const VALUE_ITEM_HEIGHT_PX = 48;
// The row menu's column. While a field is edited it folds away, and Usage takes
// its width, so no other column moves.
const MENU_COLUMN_PX = 36;

const SCHEMA_EXPORT_FORMATS: { id: string; label: string }[] = [
  { id: "json", label: "JSON Schema" },
  { id: "typescript", label: "TypeScript" },
  { id: "protobuf", label: "Protobuf" },
  { id: "python", label: "Python" },
  { id: "go", label: "Go" },
  { id: "rust", label: "Rust" },
];

// Derived from the displayed revision, so the export is revision-sensitive.
// Schemas keyed by format id; named projections listed separately.
type ConfigExportPayloads = {
  ownValue: string;
  resolvedValue: string;
  ownSchema: Record<string, string>;
  effectiveSchema: Record<string, string>;
  ownProjections: { source: string; label: string; text: string }[];
  // Validation rules (mongrule), empty string when the config has none.
  validationMongrule: string;
};

// "Resolved" variants walk the inheritance tree (and resolve constants for the value).
function ConfigExportMenu({ payloads }: { payloads: ConfigExportPayloads }) {
  const { performCopy, copySuccess, copySupported } = useCopyToClipboard({
    timeout: 2000,
  });
  if (!copySupported) return null;

  const item = (
    label: string,
    description: string | null,
    text: string,
    // Lets an item without a description match the height of one with it.
    minHeight?: number,
  ) => (
    <DropdownMenuItem
      onClick={() => performCopy(text)}
      style={{ height: "auto", minHeight }}
    >
      <Flex direction="column" gap="0" py="1">
        <Text weight="medium">{label}</Text>
        {description && (
          <Box
            as="span"
            style={{
              fontSize: "var(--font-size-1)",
              color: "currentColor",
              opacity: 0.7,
            }}
          >
            {description}
          </Box>
        )}
      </Flex>
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu
      menuPlacement="end"
      menuWidth={280}
      variant="soft"
      color="violet"
      trigger={
        <Button variant="outline" size="md">
          {/* A copy shows as the check; the label keeps the button's width. */}
          <Flex align="center" gap="2">
            {copySuccess ? <PiCheck /> : <PiCopy />}
            <Flex align="center" gap="1">
              Copy
              <PiCaretDown />
            </Flex>
          </Flex>
        </Button>
      }
    >
      {item("Copy Config", null, payloads.ownValue, VALUE_ITEM_HEIGHT_PX)}
      {item(
        "Copy resolved Config",
        "Inheritance + Constants resolved",
        payloads.resolvedValue,
        VALUE_ITEM_HEIGHT_PX,
      )}
      <DropdownMenuSeparator />
      <DropdownSubMenu trigger="Copy schema">
        {SCHEMA_EXPORT_FORMATS.map((f) => (
          <React.Fragment key={f.id}>
            {item(f.label, null, payloads.ownSchema[f.id])}
          </React.Fragment>
        ))}
        {payloads.ownProjections.length > 0 && <DropdownMenuSeparator />}
        {payloads.ownProjections.map((p) => (
          <React.Fragment key={p.source}>
            {item(p.label, "Named projection", p.text)}
          </React.Fragment>
        ))}
      </DropdownSubMenu>
      <DropdownSubMenu trigger="Copy resolved schema">
        {SCHEMA_EXPORT_FORMATS.map((f) => (
          <React.Fragment key={f.id}>
            {item(f.label, null, payloads.effectiveSchema[f.id])}
          </React.Fragment>
        ))}
      </DropdownSubMenu>
      {payloads.validationMongrule && (
        <>
          <DropdownMenuSeparator />
          {item("Validation rules", null, payloads.validationMongrule)}
        </>
      )}
    </DropdownMenu>
  );
}

export default function ConfigDetailPage(): React.ReactElement {
  const router = useRouter();
  const { cfgid } = router.query;
  const configKey = typeof cfgid === "string" ? cfgid : "";

  const { apiCall } = useAuth();
  const {
    configs,
    _configsIncludingArchived: allConfigsForGraph,
    mutateDefinitions,
  } = useDefinitions();
  const {
    organization,
    hasCommercialFeature,
    userId: currentUserId,
  } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const environments = useEnvironments();

  const [editInfoOpen, setEditInfoOpen] = useState<
    false | "info" | "description"
  >(false);
  const [confirmRevert, setConfirmRevert] = useState(false);
  const [revisionToRevert, setRevisionToRevert] = useState<Revision | null>(
    null,
  );
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [lockConfirm, setLockConfirm] = useState<"lock" | "unlock" | null>(
    null,
  );
  const [showOverrides, setShowOverrides] = useState(false);
  const [showCreateChild, setShowCreateChild] = useState(false);
  const [composeAdding, setComposeAdding] = useState(false);

  // Page-level tabs (Overview | Review & Publish | Validation).
  const [tab, setTab] = useState<"overview" | "validation" | "review">(
    "overview",
  );
  // Inner content view shown under the Overview tab.
  const [activeTab, setActiveTab] = useState<"form" | "json" | "resolved">(
    "form",
  );
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  // Failures from row menu actions and from opening a draft, which have no
  // editor of their own to show them in.
  const [actionError, setActionError] = useState<string | null>(null);
  // Separate from the text so an explicit null and a concrete value stay distinct
  // (not overriding at all is a third axis: the inherit / Reset action).
  const [editKind, setEditKind] = useState<"value" | "null">("value");
  // What the open value edit started from. Untouched, it has nothing to save,
  // unless it sets a value that had none or pins an inherited one here.
  const [editSeed, setEditSeed] = useState<
    ValueEditSeed & { savesUntouched: boolean }
  >({ text: "", kind: "value", savesUntouched: false });
  const [savingValue, setSavingValue] = useState(false);
  // An edit asked for on live waits here until its draft is showing. Tied to
  // the Config and draft it was meant for, so it never runs anywhere else.
  const [pendingEdit, setPendingEdit] = useState<{
    configKey: string;
    revisionId: string;
    edit: LiveEdit;
  } | null>(null);
  const configKeyRef = useRef(configKey);
  configKeyRef.current = configKey;
  const runEditRef = useRef<(edit: LiveEdit) => void>(() => undefined);
  const [openingDraft, setOpeningDraft] = useState(false);
  const rulesEditorRef = useRef<RulesEditorHandle>(null);
  // A field-form or JSON save in flight.
  const [editorSaving, setEditorSaving] = useState(false);

  // The key whose field definition is open, or a blank form for a new field.
  const [schemaEdit, setSchemaEdit] = useState<string | null>(null);
  const [addingField, setAddingField] = useState(false);
  const [fieldDirty, setFieldDirty] = useState(false);
  // An open edit holds the page, as other pages' edit ribbons do: other edits
  // wait. Leaving, or switching away from it, asks first if it has changes.
  const [jsonDirty, setJsonDirty] = useState(false);
  const editOpen =
    editKey !== null || schemaEdit !== null || addingField || jsonDirty;
  const editsBlocked = editOpen
    ? EDITS_BLOCKED_REASON
    : openingDraft
      ? "Opening a draft…"
      : null;
  const valueDirty =
    editKey !== null &&
    (editText !== editSeed.text || editKind !== editSeed.kind);
  const unsavedChanges = valueDirty || fieldDirty || jsonDirty;

  const cancelEdits = () => {
    setEditKey(null);
    setEditError(null);
    setSavingValue(false);
    setSchemaEdit(null);
    setAddingField(false);
  };
  const closeEdits = () => withViewTransition(cancelEdits);
  // A revision switch (`?v=`) drops edits too, so Back and Forward ask first.
  const navigationGuard = useUnsavedChangesGuard(
    unsavedChanges,
    cancelEdits,
    REVISION_QUERY,
  );
  // Tabs, views and revisions don't keep an open edit; one with changes asks
  // first, and one being saved waits for it.
  const discardThen = (next: () => void) => {
    if (savingValue || editorSaving) return;
    navigationGuard.confirmThen(() => {
      cancelEdits();
      next();
    });
  };

  const [composeError, setComposeError] = useState<string | null>(null);

  // Serializes mixin (`extends`) writes: without it, two quick clicks each compute
  // `next` from a stale snapshot and the second clobbers the first.
  const savingExtendsRef = useRef(false);
  // Same for removals: a field removal writes the whole value and schema.
  const removingRef = useRef(false);
  // The page as last rendered, kept up while another Config loads.
  const lastPage = useRef<React.ReactElement | null>(null);

  // Page-level tab driven by the URL hash. The hash may carry an inner sub-tab
  // after a comma (`#review,changes`); only the first segment selects the page tab.
  useEffect(() => {
    const hash = (new URL(router.asPath, "http://x").hash
      .replace(/^#/, "")
      .split(",")[0] || undefined) as
      | "overview"
      | "validation"
      | "review"
      | undefined;
    if (hash === "overview" || hash === "validation" || hash === "review") {
      setTab(hash);
    }
  }, [router.asPath]);
  const setTabAndScroll = (newTab: "overview" | "validation" | "review") => {
    const go = () => {
      setTab(newTab);
      router.replace(
        { pathname: router.pathname, query: router.query, hash: newTab },
        undefined,
        { shallow: true },
      );
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
    // Edits live on the Overview tab, so leaving it closes them.
    if (newTab === tab) go();
    else discardThen(go);
  };

  const details = useDetailsPanel({
    openKey: `config-details-panel-open__${configKey}`,
    widthKey: "config-details-panel-width",
    tab,
    homeTab: ["overview", "validation"],
  });
  const lineagePanel = useDetailsPanel({
    openKey: "config-lineage-panel-open",
    widthKey: "config-lineage-panel-width",
    tab,
    homeTab: "overview",
    defaultWidth: LINEAGE_PANEL_WIDTH_PX,
  });
  const tabsBottom = useTabsBottom();
  // Where the JSON tab's Save and Discard render: the bar along the bottom.
  const [ribbonEl, setRibbonEl] = useState<HTMLDivElement | null>(null);
  const [setStatusBarEl, statusBarHeight] = useRevisionStatusBarHeight();

  // Forward the selected revision so a draft's unpublished lineage drives resolution server-side.
  const versionParam = typeof router.query.v === "string" ? router.query.v : "";
  const { data, error, mutate } = useApi<ResolvedResponse>(
    `/configs/${configKey}/resolved${versionParam ? `?v=${versionParam}` : ""}`,
    { shouldRun: () => !!configKey },
  );
  const config = data?.config;

  // Env flavors render in the tree grouped under their parent's "Environments"
  // label (see LineageTree), so the tree gets the full lineage. The "Configs"
  // count, though, is standalone configs only — exclude flavors (the marker).
  const nonFlavorCount = useMemo(
    () => (data?.lineage ?? []).filter((n) => !isScopedConfig(n)).length,
    [data?.lineage],
  );

  const {
    selectedRevision,
    selectedRevisionId,
    selectionSettled,
    revisionsError,
    openRevisions,
    allRevisions,
    selectRevision,
    onRevisionCreated,
    handlePublish,
    handleDiscard,
    handleReopen,
    mutateRevisions,
    userOpenRevision,
  } = useConstantRevision(config?.id, mutate, config, "config");

  const liveRevision = useMemo(
    () => getLiveRevision(allRevisions) ?? null,
    [allRevisions],
  );
  const panelRevision = selectedRevision ?? liveRevision;

  // The page instance is reused across configs (and the selected revision can
  // change under an open editor), so clear in-progress edits when either changes.
  useEffect(() => {
    setEditKey(null);
    setEditText("");
    setEditError(null);
    setComposeError(null);
    setEditKind("value");
    setSchemaEdit(null);
    setAddingField(false);
    setActionError(null);
    setShowCreateChild(false);
    setComposeAdding(false);
    setShowOverrides(false);
    // Also close any modal carried over from the previous config.
    setCompareOpen(false);
    setConfirmRevert(false);
    setShowArchiveModal(false);
    setShowAuditModal(false);
    setEditInfoOpen(false);
    setConfirmDelete(false);
    setMenuOpen(false);
  }, [configKey, selectedRevisionId]);

  const {
    references: familyReferences,
    loading: familyReferencesLoading,
    error: familyReferencesError,
  } = useConfigFamilyReferences(config?.id);

  const { usage: keyUsage } = useConfigKeyUsage(config?.id);
  const implementationsByKey = useMemo(() => {
    const map = new Map<string, ConfigKeyImplementation[]>();
    for (const impl of keyUsage?.implementations ?? []) {
      for (const key of impl.keys) {
        const list = map.get(key);
        if (list) list.push(impl);
        else map.set(key, [impl]);
      }
    }
    return map;
  }, [keyUsage]);

  // Scrub cycle-creating keys + own key so a value can't reference back into a cycle.
  const { data: cyclicData } = useApi<{ cyclicKeys: string[] }>(
    config?.id ? `/configs/${config.id}/cyclic-keys` : "",
    { shouldRun: () => !!config?.id },
  );
  const constantContext = useMemo(
    () => ({
      project: config?.project || undefined,
      excludeKeys: [
        ...(cyclicData?.cyclicKeys ?? []),
        ...(config?.key ? [config.key] : []),
      ],
    }),
    [config?.project, config?.key, cyclicData?.cyclicKeys],
  );

  // Table display only; the editor and JSON view keep refs raw.
  const squashConstants = useMemo(() => {
    const map = buildConstantValueMap(data?.constants ?? [], "");
    const project = config?.project || "";
    return (value: unknown): unknown =>
      resolveConstantRefs(value, map, new Set(), undefined, project);
  }, [data?.constants, config?.project]);

  const settings = organization.settings || {};
  const hasApprovalsFeature = hasCommercialFeature("require-approvals");
  // Creating configs is premium-gated; editing existing ones is not (permissive on lapse).
  const hasConfigsFeature = hasCommercialFeature("feature-configs");

  // Drives the coarse "is approval configured" gate; per-revision uses constantRequiresReview.
  const requireReviews = settings.requireReviews;
  const reviewRule =
    hasApprovalsFeature && Array.isArray(requireReviews)
      ? getReviewSetting(requireReviews, { project: config?.project })
      : undefined;
  const approvalRequired =
    hasApprovalsFeature &&
    (requireReviews === true || !!reviewRule?.requireReviewOn);
  const metadataReviewRequired =
    approvalRequired &&
    (requireReviews === true
      ? true
      : (reviewRule?.featureRequireMetadataReview ?? true));

  const isDraft =
    !!selectedRevision && isActiveDraftStatus(selectedRevision.status);
  // A draft published, discarded or scheduled from elsewhere closes open edits.
  const draftTakesEdits =
    isDraft && !isRevisionEditLockedBySchedule(selectedRevision);
  useEffect(() => {
    if (draftTakesEdits) return;
    setEditKey(null);
    setSchemaEdit(null);
    setAddingField(false);
  }, [draftTakesEdits]);
  useEffect(() => {
    if (!pendingEdit) return;
    if (
      pendingEdit.configKey !== configKey ||
      (selectedRevisionId !== null &&
        selectedRevisionId !== pendingEdit.revisionId)
    ) {
      setPendingEdit(null);
      return;
    }
    if (selectedRevisionId === null || !draftTakesEdits || !data) return;
    setPendingEdit(null);
    runEditRef.current(pendingEdit.edit);
  }, [pendingEdit, configKey, selectedRevisionId, draftTakesEdits, data]);

  const selectedRevisionRequiresApproval =
    !!selectedRevision &&
    hasApprovalsFeature &&
    constantRequiresReview(
      {
        project: (selectedRevision.target.snapshot as ConfigInterface).project,
      },
      getConstantRevisionChange(
        selectedRevision.target.snapshot as ConfigInterface,
        selectedRevision.target.proposedChanges,
      ),
      settings,
    );

  // Show the selected revision's proposed state when one is selected.
  const displayedConfig = useMemo(() => {
    if (!selectedRevision) return config;
    return applyTopLevelPatchOps(
      selectedRevision.target.snapshot as ConfigInterface,
      selectedRevision.target.proposedChanges,
    ) as ConfigInterface;
  }, [selectedRevision, config]);

  // Formats whose data differs between draft and published (editor shows an amber dot).
  // A schema change flags every format; a projection change also flags that one source.
  const unpublishedFormats = useMemo(() => {
    const set = new Set<string>();
    if (!config || !displayedConfig) return set;
    const schemaChanged = !isEqual(
      displayedConfig.schema ?? null,
      config.schema ?? null,
    );
    if (schemaChanged) {
      // Every format derives from the schema, so flag them all.
      SCHEMA_EXPORT_FORMATS.forEach((f) => set.add(f.id));
    }
    const draftRP = displayedConfig.renderProjections ?? {};
    const liveRP = config.renderProjections ?? {};
    for (const source of new Set([
      ...Object.keys(draftRP),
      ...Object.keys(liveRP),
    ])) {
      if (
        schemaChanged ||
        !isEqual(draftRP[source] ?? null, liveRP[source] ?? null)
      ) {
        set.add(`proj:${source}`);
      }
    }
    return set;
  }, [config, displayedConfig]);

  // Substitute this node's displayed (possibly draft) value so the table reflects the revision.
  // The chain with the displayed revision standing in for this Config.
  const displayChain = useMemo(
    () =>
      !data || !displayedConfig
        ? []
        : data.chain.map((n) =>
            n.key === displayedConfig.key
              ? {
                  ...n,
                  value: displayedConfig.value,
                  schema: displayedConfig.schema,
                }
              : n,
          ),
    [data, displayedConfig],
  );
  const resolved = useMemo(
    () =>
      displayChain.length
        ? resolveConfigChain(displayChain)
        : {
            effectiveSchema: [] as SchemaField[],
            fields: [] as ResolvedField[],
          },
    [displayChain],
  );

  // What the chain's `$extends` Constant layers supply, under its own keys as
  // when served. Checks that skipped them would miss the fields they fill. An
  // archived base isn't served, so neither are its layers.
  const layerValues = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const node of displayChain) {
      if (node.key !== config?.key && data?.archivedByKey?.[node.key]) {
        continue;
      }
      const refs = parsePlainJSONObject(node.value ?? "")?.[
        CONSTANT_EXTENDS_KEY
      ];
      if (!Array.isArray(refs) || !refs.length) continue;
      const layer = squashConstants({ [CONSTANT_EXTENDS_KEY]: refs });
      if (layer && typeof layer === "object" && !Array.isArray(layer)) {
        Object.assign(out, layer);
      }
    }
    return out;
  }, [displayChain, squashConstants, config?.key, data?.archivedByKey]);

  // For the read-only Resolved tab (inheritance *and* constants); the Form tab squashes per-row.
  const resolvedFieldsResolved = useMemo(
    () =>
      resolved.fields.map((f) => ({
        ...f,
        value:
          f.value === undefined ? layerValues[f.key] : squashConstants(f.value),
      })),
    [resolved.fields, squashConstants, layerValues],
  );

  // The resolved (inherited+own) value cross-field rules run against, with
  // Constant references resolved to what's served. Present keys only.
  const invariantValue = useMemo(() => {
    const o: Record<string, unknown> = { ...layerValues };
    for (const f of resolved.fields) {
      if (f.value !== undefined) o[f.key] = squashConstants(f.value);
    }
    return o;
  }, [resolved.fields, squashConstants, layerValues]);

  // Rules from the Configs this one builds on, the nearest winning a shared name.
  const inheritedInvariants = useMemo(() => {
    const byName = new Map<string, InheritedInvariant>();
    for (const node of data?.chain ?? []) {
      if (node.key === config?.key) continue;
      for (const invariant of node.schema?.invariants ?? []) {
        byName.set(invariant.name, {
          invariant,
          sourceKey: node.key,
          sourceName: node.name ?? node.key,
        });
      }
    }
    return [...byName.values()];
  }, [data?.chain, config?.key]);

  // Every rule this Config is checked against: those it inherits, with its own
  // replacing any of the same name.
  const effectiveInvariants = useMemo(() => {
    const own = displayedConfig?.schema?.invariants ?? [];
    const ownNames = new Set(own.map((iv) => iv.name));
    return [
      ...inheritedInvariants
        .map((r) => r.invariant)
        .filter((iv) => !ownNames.has(iv.name)),
      ...own,
    ];
  }, [displayedConfig, inheritedInvariants]);

  // Rules that currently fail against the displayed (draft-aware) value.
  const failingInvariants = useMemo(
    () => evaluateInvariants(invariantValue, effectiveInvariants),
    [invariantValue, effectiveInvariants],
  );

  // Field key → messages of the failing rules that reference it, for row-level
  // highlighting on the Form tab.
  const failingFieldInfo = useMemo(() => {
    const map = new Map<string, string[]>();
    const failingNames = new Set(failingInvariants.map((v) => v.name));
    for (const inv of effectiveInvariants) {
      if (!failingNames.has(inv.name)) continue;
      for (const key of invariantRuleFields(inv.rule)) {
        map.set(key, [...(map.get(key) ?? []), inv.message]);
      }
    }
    return map;
  }, [failingInvariants, effectiveInvariants]);

  const parentKey = useMemo(() => {
    const self = data?.lineage.find((n) => n.key === config?.key);
    return self?.parentKey ?? null;
  }, [data?.lineage, config?.key]);

  // The root of this Config's parent chain, where family-wide rules and hooks go.
  const baseNode = useMemo(() => {
    const lineage = data?.lineage ?? [];
    let node = lineage.find((n) => n.key === config?.key);
    // A draft can stage a parent cycle; stop at a repeat.
    const seen = new Set<string>();
    while (node?.parentKey && !seen.has(node.key)) {
      seen.add(node.key);
      const parent = node.parentKey;
      node = lineage.find((n) => n.key === parent);
    }
    return node ?? null;
  }, [data?.lineage, config?.key]);

  // The flag lives on the root: a root reads it draft-aware off the displayed revision,
  // a child uses the server-computed family value. Drives schema `additionalProperties`.
  const effectiveExtensible =
    parentKey === null
      ? (displayedConfig?.extensible ??
        settings.configsExtensibleByDefault ??
        true)
      : (data?.extensible ?? settings.configsExtensibleByDefault ?? true);

  // Resolved by the parent chain (this config excluded) so an override row can show
  // the inherited value it replaces.
  const parentFieldValues = useMemo(() => {
    const map = new Map<string, unknown>();
    if (!data || !displayedConfig || !parentKey) return map;
    const parentChain = data.chain
      .map((n) =>
        n.key === displayedConfig.key
          ? {
              ...n,
              value: displayedConfig.value,
              schema: displayedConfig.schema,
            }
          : n,
      )
      .filter((n) => n.key !== displayedConfig.key);
    for (const f of resolveConfigChain(parentChain).fields) {
      map.set(f.key, f.value);
    }
    return map;
  }, [data, displayedConfig, parentKey]);

  // Descendants declaring a key this config also declares; publishing strips the
  // redundant definitions ("base wins"). Above the loading guard for stable hook order.
  const reconciliationPreview = useMemo(() => {
    if (!data || !displayedConfig)
      return [] as { name: string; keys: string[] }[];
    const ownKeys = (displayedConfig.schema?.fields ?? []).map((sf) => sf.key);
    // Include composing families so a mixin descendant's strip is previewed too
    // (the cascade reconciles via `extends`, not just the `parent` spine). The
    // helper walks the full subtree and self-restricts to real descendants.
    const nodes = [
      ...data.lineage,
      ...(data.composerFamilies ?? []).flatMap((f) => f.lineage),
    ];
    return computeConfigReconciliationPreview(
      nodes,
      displayedConfig.key,
      ownKeys,
    );
  }, [data, displayedConfig]);

  // Descendants the displayed draft would leave with orphaned (undeclared) or
  // type-incompatible overrides — the lineage is computed draft-aware server-side,
  // so this is pure collection. Above the loading guard for stable hook order.
  const draftDescendantImpact = useMemo(() => {
    if (!data || !displayedConfig) return [] as LineageNode[];
    return data.lineage.filter(
      (n) =>
        n.key !== displayedConfig.key &&
        ((n.orphanedFields?.length ?? 0) > 0 ||
          (n.incompatibleFields?.length ?? 0) > 0),
    );
  }, [data, displayedConfig]);

  // This config's own value keys no schema declares, as the tree flags them.
  const undeclaredKeys = useMemo(
    () =>
      new Set(
        data?.lineage.find((n) => n.key === config?.key)?.orphanedFields ?? [],
      ),
    [data?.lineage, config?.key],
  );

  // Schema issues in the displayed, resolved value, by top-level key.
  const schemaIssuesByKey = useMemo(
    () =>
      collectConfigValueIssuesByKey({
        value: {
          ...layerValues,
          ...Object.fromEntries(
            resolved.fields
              .filter((f) => f.value !== undefined)
              .map((f) => [f.key, f.value]),
          ),
        },
        fields: resolved.effectiveSchema,
      }),
    [resolved, layerValues],
  );

  // Field key → descendants whose definition of it publishing strips.
  const reconciledDescendants = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const { name, keys } of reconciliationPreview) {
      for (const k of keys) map.set(k, [...(map.get(k) ?? []), name]);
    }
    return map;
  }, [reconciliationPreview]);

  // Other family members whose effective rules fail against the displayed
  // (draft-aware) state. Above the loading guard for stable hook order.
  const familyRuleFailures = useMemo(() => {
    if (!data || !displayedConfig) return [];
    const nodes = [
      ...data.lineage,
      ...(data.composerFamilies ?? []).flatMap((f) => f.lineage),
    ];
    const seen = new Set<string>([displayedConfig.key]);
    return nodes
      .filter((n) => {
        if (seen.has(n.key) || !n.invariantViolations?.length) return false;
        seen.add(n.key);
        return true;
      })
      .map((node) => ({
        node,
        relation: configRelation(node.key, displayedConfig.key, nodes),
      }));
  }, [data, displayedConfig]);

  // Derived from the displayed revision (drafts export their proposed state).
  // Above the loading guard for stable hook order.
  const exportPayloads = useMemo<ConfigExportPayloads>(() => {
    const prettyJSON = (text: string): string => {
      try {
        return JSON.stringify(JSON.parse(text || "{}"), null, 2);
      } catch {
        return text || "{}";
      }
    };
    const schemaToJson = (fields: SchemaField[]): string => {
      if (!fields.length) {
        return JSON.stringify(
          {
            type: "object",
            properties: {},
            additionalProperties: effectiveExtensible,
          },
          null,
          2,
        );
      }
      try {
        return JSON.stringify(
          JSON.parse(
            simpleToJSONSchema({
              type: "object",
              fields,
              additionalProperties: effectiveExtensible,
            }),
          ),
          null,
          2,
        );
      } catch {
        return JSON.stringify({ type: "object" }, null, 2);
      }
    };

    const ownFields = displayedConfig?.schema?.fields ?? [];
    const ap = effectiveExtensible;
    const codeRenderers: Record<
      string,
      (f: SchemaField[], p?: SchemaProjection) => string
    > = {
      typescript: (f, p) =>
        fieldsToTsType(f, { additionalProperties: ap, projection: p }),
      protobuf: (f, p) =>
        fieldsToProto(f, { additionalProperties: ap, projection: p }),
      python: (f, p) =>
        fieldsToPython(f, { additionalProperties: ap, projection: p }),
      go: (f, p) =>
        fieldsToGolang(f, { additionalProperties: ap, projection: p }),
      rust: (f, p) =>
        fieldsToRust(f, { additionalProperties: ap, projection: p }),
    };
    const renderAll = (fields: SchemaField[]): Record<string, string> => {
      const out: Record<string, string> = { json: schemaToJson(fields) };
      for (const [id, render] of Object.entries(codeRenderers)) {
        out[id] = render(fields);
      }
      return out;
    };

    const projections = displayedConfig?.renderProjections ?? {};
    const ownProjections = Object.entries(projections).map(([source, p]) => ({
      source,
      label: `${source} (${SCHEMA_LANG_LABEL[p.language] ?? p.language})`,
      text: (codeRenderers[p.language] ?? codeRenderers.typescript)(
        ownFields,
        p,
      ),
    }));

    const ownInvariants = displayedConfig?.schema?.invariants ?? [];
    const validationMongrule = ownInvariants.length
      ? JSON.stringify(
          ownInvariants.map((iv) => {
            let rule: unknown = iv.rule;
            try {
              rule = JSON.parse(iv.rule);
            } catch {
              // keep the raw string if it isn't valid JSON
            }
            return { name: iv.name, rule, message: iv.message };
          }),
          null,
          2,
        )
      : "";

    return {
      ownValue: prettyJSON(displayedConfig?.value ?? "{}"),
      resolvedValue: JSON.stringify(invariantValue, null, 2),
      ownSchema: renderAll(ownFields),
      effectiveSchema: renderAll(resolved.effectiveSchema),
      ownProjections,
      validationMongrule,
    };
  }, [
    displayedConfig?.value,
    displayedConfig?.schema,
    displayedConfig?.renderProjections,
    resolved,
    effectiveExtensible,
    invariantValue,
  ]);

  // Above the early returns: hooks must run in the same order every render, so
  // this cannot sit below the loading guard. `config` is not proven present yet,
  // hence the null-safe body.
  //
  // The footprint the publish endpoint will derive for the selected revision: the
  // Config's scoped environments, widened to everywhere it serves when the
  // revision flips `archived` either way. A base Config scopes to none, and an
  // empty footprint SKIPS the environment check rather than narrowing it.
  const revisionPublishEnvironments = useMemo(() => {
    if (!config) return [];
    const scoped = configPublishEnvironments(config);
    if (!panelRevision) return scoped;
    return revisionPublishFootprint({
      proposedChanges: {
        archived: proposedArchivedValue(panelRevision.target.proposedChanges),
      },
      currentArchived: config.archived,
      scoped,
      serving: serveFootprint(environments, config),
    });
  }, [panelRevision, config, environments]);

  // A failed refresh keeps the revisions already shown.
  const loadError = error ?? (selectionSettled ? undefined : revisionsError);
  if (loadError) {
    return (
      <Callout status="error" mt="4">
        An error occurred: {loadError.message}
      </Callout>
    );
  }
  // One wrapper around both the live page and a kept one, so swapping between
  // them updates in place. A kept page is inert until the next one is ready.
  const pageShell = (page: React.ReactElement, pending: boolean) => (
    <div
      ref={(el) => {
        if (el) el.inert = pending;
      }}
      style={{ display: "contents" }}
      aria-busy={pending || undefined}
    >
      {page}
    </div>
  );
  if (!data || !config || !displayedConfig || !selectionSettled) {
    // A first load has no page to keep, so it shows a loading screen.
    return lastPage.current ? (
      pageShell(lastPage.current, true)
    ) : (
      <LoadingOverlay />
    );
  }

  const handleLock = async (reason?: string) => {
    await apiCall(`/configs/${config.id}/lock`, {
      method: "POST",
      body: JSON.stringify(reason ? { reason } : {}),
    });
    await mutate();
    mutateDefinitions();
  };

  const handleUnlock = async () => {
    await apiCall(`/configs/${config.id}/unlock`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    await mutate();
    mutateDefinitions();
  };

  const handleExperimentGuard = async (enabled: boolean) => {
    await apiCall(`/configs/${config.id}/experiment-guard`, {
      method: "POST",
      body: JSON.stringify({ enabled }),
    });
    await mutate();
    mutateDefinitions();
  };

  const canDraft = permissionsUtil.canRevisionAction(
    "config",
    "draft",
    config,
    NO_ENVIRONMENT_BINDING,
  );
  // Reverting is its own authority — a revert-only role holds no draft or
  // publish rights, and revert alone is enough to both propose and land one.
  // Proposing a revert publishes nothing, so it is project-scoped; landing one
  // answers for the environments the restore reaches. Footprinting both left an
  // environment-limited reverter unable to even stage a revert for a publisher.
  const canRevertEntity = permissionsUtil.canRevisionAction(
    "config",
    "revert",
    config,
    NO_ENVIRONMENT_BINDING,
  );
  const canRevertLandingEntity = permissionsUtil.canRevisionAction(
    "config",
    "revert",
    config,
    // The SELECTED revision's footprint, not the Config's bare scope: restoring a
    // revision that flips `archived` takes the Config out of service, or returns it,
    // everywhere it serves — which is exactly the widening `revisionPublishEnvironments`
    // above already computes for the publish control. The scoped list under-scopes it,
    // and for a base Config it is empty, which skips the environment check entirely.
    revisionPublishEnvironments,
  );
  // Lock and the experiment guard are written straight to the live Config, never
  // staged in a revision, so they take the publish atom — matching lockConfig and
  // setConfigExperimentGuard on the server. Gating them on the draft atom offered
  // a control that then 403'd.
  const canPublishNow = permissionsUtil.canRevisionAction(
    "config",
    "publish",
    config,
    configPublishEnvironments(config),
  );
  // Delete leaf-up: a config that others still derive from (parent-spine
  // children, composition mixins, or env/project overrides) can't be deleted
  // until those are gone. Mirrors the server's assertConfigDeletable so the UI
  // doesn't offer a delete that would fail; deleting the descendants first (each
  // lands you back on this parent) eventually makes it a deletable leaf.
  const hasDescendants = (data?.lineage ?? []).some(
    (n) =>
      n.key !== config.key &&
      (n.parentKey === config.key ||
        (n.extendsKeys ?? []).includes(config.key)),
  );
  // Delete requires the Config to be archived first, and an archived Config is
  // serving nothing anywhere — so the server takes no environment for it. Pass
  // the same, or an env-limited deleter would be shown no Delete control for a
  // Config they are in fact allowed to remove.
  // Structural precondition stays here; the authority rule does not.
  const canDeleteNow =
    canDeleteArchivedEntity(permissionsUtil, "config", config) &&
    !hasDescendants;
  // A locked Config still takes drafts; only publishing waits for an unlock. A
  // draft locked for a scheduled publish keeps its info controls, disabled.
  const isLocked = !!config.lock;
  const canEditInfo = canDraft && (!selectedRevision || isDraft);
  const editLockReason =
    selectedRevision &&
    isDraft &&
    isRevisionEditLockedBySchedule(selectedRevision)
      ? SCHEDULE_EDIT_LOCK_REASON
      : null;
  const canEditNow = canEditInfo && !editLockReason;
  // Archiving is delete-class server-side — it takes the Config out of service,
  // and being archived is what allows deleting it. Unarchiving returns it to
  // service, so it's an ordinary publish.
  // Either authority is enough: the landing atom stands on its own for a pure
  // archive, and an editor without it can still stage the flip as a draft.
  const canLandArchive = canLandArchiveToggle(
    permissionsUtil,
    "config",
    config,
    // Flipping `archived` reaches everywhere the Config serves; a base Config
    // names no scoped environments, and an empty footprint SKIPS the environment
    // check instead of narrowing it.
    archiveFootprintForControl({
      environments,
      entity: config,
      scoped: configPublishEnvironments(config),
    }),
  );
  const canArchiveNow =
    (canLandArchive || canEditNow) && (!selectedRevision || isDraft);
  // Fields, mixins and rules edit only inside a draft. From live, an edit
  // opens your draft, or starts one, and carries on there.
  const canEditInline = canEditNow && isDraft;
  const editsFromLive = canEditNow && !selectedRevision;
  const canStartEdits = canEditInline || editsFromLive;
  // No row has a menu while editing or where nothing can be edited.
  const hideRowMenus = editOpen || !canStartEdits;
  const canBypassApproval = permissionsUtil.canBypassFlagApprovalChecks(
    {
      project: config.project || "",
    },
    "config",
  );

  const revisionCtx: ConstantRevisionContext = {
    allRevisions,
    openRevisions,
    selectedRevision,
    approvalRequired,
    metadataReviewRequired,
    canBypassApproval,
    // Locked, a save can still make a draft but can't publish.
    canPublish: canPublishNow && !isLocked,
  };

  const ownValue = (): Record<string, unknown> =>
    parsePlainJSONObject(displayedConfig.value ?? "") ?? {};

  // Inline edits write to the draft in view; a new draft is only a safe
  // fallback, never a direct publish.
  const writeQuery = (): string =>
    selectedRevision && isDraft
      ? `?revisionId=${selectedRevision.id}`
      : `?forceCreateRevision=1`;

  // One property per request, so a stale read can't drop properties another
  // writer added.
  const savePropertyValue = async (property: string, value: unknown) => {
    const res = await apiCall<{ revision?: Revision }>(
      `/configs/${config.id}/property${writeQuery()}`,
      { method: "PUT", body: JSON.stringify({ property, value }) },
    );
    await mutate();
    if (res?.revision) await onRevisionCreated(res.revision);
  };

  const removePropertyValue = async (property: string) => {
    const res = await apiCall<{ revision?: Revision }>(
      `/configs/${config.id}/property${writeQuery()}`,
      { method: "DELETE", body: JSON.stringify({ property }) },
    );
    await mutate();
    if (res?.revision) await onRevisionCreated(res.revision);
  };

  // Serialized via savingExtendsRef + awaited so errors surface instead of unhandled rejections.
  const saveExtends = async (next: string[]) => {
    if (savingExtendsRef.current) return;
    savingExtendsRef.current = true;
    setComposeError(null);
    try {
      const res = await apiCall<{ revision?: Revision }>(
        `/configs/${config.id}${writeQuery()}`,
        { method: "PUT", body: JSON.stringify({ extends: next }) },
      );
      await mutate();
      if (res?.revision) await onRevisionCreated(res.revision);
    } catch (e) {
      setComposeError(
        e instanceof Error ? e.message : "Failed to update mixins",
      );
    } finally {
      savingExtendsRef.current = false;
    }
  };

  const startOverride = (f: ResolvedField) =>
    withViewTransition(() => {
      cancelEdits();
      const seed = valueEditSeed(f.field, f.value);
      setEditKind(seed.kind);
      setEditText(seed.text);
      setEditSeed({
        ...seed,
        savesUntouched: f.value === undefined || f.source !== config.key,
      });
      setEditKey(f.key);
    });

  const submitOverride = async () => {
    if (!editKey || savingValue) return;
    if (!valueDirty && !editSeed.savesUntouched) {
      closeEdits();
      return;
    }
    const result = parseFieldValueInput(
      editText,
      resolved.fields.find((f) => f.key === editKey)?.field ?? null,
      editKind === "null",
    );
    // Save is disabled while the value can't be parsed.
    if (result.kind === "error") return;
    setSavingValue(true);
    try {
      await savePropertyValue(editKey, result.value);
      closeEdits();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Failed to save value");
      setSavingValue(false);
    }
  };

  const ownSchema = (): SimpleSchema =>
    displayedConfig.schema ?? { type: "object", fields: [] };
  const ownSchemaKeys = ownSchema().fields.map((sf) => sf.key);

  // Ancestor-owned keys: declaring one is a "base wins" collision; valuing one is an override.
  const ancestorOwnedKeys = resolved.effectiveSchema
    .map((sf) => sf.key)
    .filter((k) => !ownSchemaKeys.includes(k));

  const saveSchema = async (
    fields: SchemaField[],
    valueOverride?: Record<string, unknown>,
    renderProjections?: Record<string, SchemaProjection>,
    invariants?: SimpleSchema["invariants"],
  ) => {
    // Preserve existing invariants across field edits; the rules editor passes a
    // new list when it changes them.
    const nextInvariants = invariants ?? ownSchema().invariants;
    const schema: SimpleSchema = {
      type: ownSchema().type,
      fields,
      ...(nextInvariants?.length ? { invariants: nextInvariants } : {}),
    };
    const res = await apiCall<{ revision?: Revision }>(
      `/configs/${config.id}${writeQuery()}`,
      {
        method: "PUT",
        body: JSON.stringify({
          schema,
          ...(valueOverride ? { value: JSON.stringify(valueOverride) } : {}),
          ...(renderProjections !== undefined ? { renderProjections } : {}),
        }),
      },
    );
    await mutate();
    if (res?.revision) await onRevisionCreated(res.revision);
  };

  const saveField = async (field: SchemaField, value?: unknown) => {
    const fields = ownSchema().fields;
    const idx = fields.findIndex((f) => f.key === schemaEdit);
    const next =
      idx >= 0
        ? fields.map((f, i) => (i === idx ? field : f))
        : [...fields, field];
    await saveSchema(
      next,
      value !== undefined ? { ...ownValue(), [field.key]: value } : undefined,
    );
    closeEdits();
  };

  const removeField = async (key: string) => {
    if (removingRef.current) return;
    removingRef.current = true;
    const v = ownValue();
    const hadOverride = key in v;
    delete v[key];
    setActionError(null);
    try {
      await saveSchema(
        ownSchema().fields.filter((f) => f.key !== key),
        hadOverride ? v : undefined,
      );
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to remove field");
    } finally {
      removingRef.current = false;
    }
  };

  // Removes only this config's override (reverts to inherited); the parent's definition is untouched.
  const removeOverride = async (key: string) => {
    if (removingRef.current) return;
    removingRef.current = true;
    setActionError(null);
    try {
      await removePropertyValue(key);
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : "Failed to remove override",
      );
    } finally {
      removingRef.current = false;
    }
  };

  const addFieldRows = addingField ? (
    <FieldDefForm
      withValue
      isNew
      initial={blankField()}
      existingKeys={resolved.fields.map((f) => f.key)}
      constantContext={constantContext}
      onDirtyChange={setFieldDirty}
      onSavingChange={setEditorSaving}
      onCancel={closeEdits}
      onSave={saveField}
    />
  ) : null;
  const renderAddField = () =>
    canStartEdits &&
    !editOpen && (
      <Box mt="2" py="1">
        <Link
          disabled={openingDraft}
          onClick={() => startEdit({ kind: "addField" })}
        >
          <Flex align="center" gap="1">
            <PiPlus />
            Add field
          </Flex>
        </Link>
      </Box>
    );

  // Candidates exclude self, parent, current mixins, and descendants (cycle). The descendant
  // walk uses the archived-inclusive graph so a cycle through an archived node is still excluded.
  const mixinKeys = displayedConfig.extends ?? [];
  const mixinDescendants = new Set(
    getConfigSubtree(config.key, allConfigsForGraph),
  );
  const composeOptions = configs
    .filter(
      (c) =>
        !c.archived &&
        c.key !== config.key &&
        c.key !== parentKey &&
        !mixinKeys.includes(c.key) &&
        !mixinDescendants.has(c.key),
    )
    .map((c) => ({ label: c.name, value: c.key }));

  // The parent is fixed at creation, so this row has no actions.
  const renderExtendsRow = () => {
    if (!parentKey) return null;
    const name =
      allConfigsForGraph.find((c) => c.key === parentKey)?.name ?? parentKey;
    return (
      <TableRow align="start">
        <TableCell>
          <Flex align="center" style={{ minHeight: 32 }}>
            <Text color="text-low">Extends</Text>
          </Flex>
        </TableCell>
        <TableCell colSpan={4}>
          <Flex align="center" gap="3" wrap="wrap" style={{ minHeight: 32 }}>
            <Link href={`/configs/${parentKey}`}>{name}</Link>
          </Flex>
        </TableCell>
        <TableCell />
      </TableRow>
    );
  };

  const renderComposeRow = () => {
    if (mixinKeys.length === 0) return null;
    return (
      <TableRow align="start">
        <TableCell>
          <Flex align="center" style={{ minHeight: 32 }}>
            <Text color="text-low">Composes</Text>
          </Flex>
        </TableCell>
        <TableCell colSpan={4}>
          <Flex align="center" gap="3" wrap="wrap" style={{ minHeight: 32 }}>
            {mixinKeys.map((k) => {
              const name =
                allConfigsForGraph.find((c) => c.key === k)?.name ?? k;
              return (
                <Link key={k} href={`/configs/${k}`}>
                  {name}
                </Link>
              );
            })}
          </Flex>
        </TableCell>
        <TableCell>
          <Flex gap="2" align="center" justify="end" style={{ minHeight: 32 }}>
            <FieldRowMenu>
              {canStartEdits &&
                mixinKeys.map((k) => {
                  const name =
                    allConfigsForGraph.find((c) => c.key === k)?.name ?? k;
                  return (
                    <DropdownMenuItem
                      key={k}
                      color="red"
                      onClick={() => startEdit({ kind: "removeMixin", key: k })}
                    >
                      Remove mixin &ldquo;{name}&rdquo;
                    </DropdownMenuItem>
                  );
                })}
            </FieldRowMenu>
          </Flex>
        </TableCell>
      </TableRow>
    );
  };

  const renderAddMixin = () => {
    if (!canStartEdits || editOpen) return null;
    return composeAdding ? (
      <Box mt="2" py="1" style={{ maxWidth: 380 }}>
        <Flex align="center" gap="3">
          <Box style={{ flex: 1 }}>
            <SelectField
              size="md"
              value=""
              placeholder={
                composeOptions.length
                  ? "Select a Config to extend with…"
                  : "No other Configs available"
              }
              options={composeOptions}
              autoFocus
              onChange={(v) => {
                setComposeAdding(false);
                if (v) saveExtends([...mixinKeys, v]);
              }}
            />
          </Box>
          <Link size="md" onClick={() => setComposeAdding(false)}>
            Cancel
          </Link>
        </Flex>
        {composeError && (
          <HelperText status="error" size="sm" mt="1">
            <MarkdownLinks text={composeError} />
          </HelperText>
        )}
      </Box>
    ) : (
      <Box mt="2" py="1">
        <Link
          disabled={openingDraft}
          onClick={() => startEdit({ kind: "addMixin" })}
        >
          <Flex align="center" gap="1">
            <PiPlus />
            Add Config mixin
          </Flex>
        </Link>
        {composeError && (
          <HelperText status="error" size="sm" mt="1">
            <MarkdownLinks text={composeError} />
          </HelperText>
        )}
      </Box>
    );
  };

  // An override is an inherited field re-valued here, not one of this config's own fields.
  const isOverrideField = (f: ResolvedField) =>
    f.source === config.key && !ownSchemaKeys.includes(f.key);
  const overrideCount = resolved.fields.filter(isOverrideField).length;
  const parentNode = parentKey
    ? data.lineage.find((n) => n.key === parentKey)
    : null;
  const parentName = parentKey ? (parentNode?.name ?? parentKey) : null;

  const revisionNumbers = getRevisionNumberById(allRevisions);
  // On live, where inline edits are off, point to a draft to edit in.
  const myDraft =
    userOpenRevision && !isRevisionEditLockedBySchedule(userOpenRevision)
      ? userOpenRevision
      : null;
  // Opens your draft, or starts one, then runs the edit there.
  const editInDraft = async (edit: LiveEdit) => {
    if (openingDraft) return;
    setActionError(null);
    const startedOn = config.key;
    if (myDraft) {
      setPendingEdit({ configKey: startedOn, revisionId: myDraft.id, edit });
      selectRevision(myDraft);
      return;
    }
    setOpeningDraft(true);
    try {
      const res = await apiCall<{ revision?: Revision }>(
        `/configs/${config.id}?forceCreateRevision=1`,
        { method: "PUT", body: JSON.stringify({}) },
      );
      // Moved to another Config meanwhile: the draft waits there, unopened.
      if (res?.revision && configKeyRef.current === startedOn) {
        setPendingEdit({
          configKey: startedOn,
          revisionId: res.revision.id,
          edit,
        });
        await onRevisionCreated(res.revision);
      }
    } catch (e) {
      if (configKeyRef.current === startedOn) {
        setActionError(
          e instanceof Error ? e.message : "Failed to open a draft",
        );
      }
    } finally {
      setOpeningDraft(false);
    }
  };
  const runEdit = (edit: LiveEdit) => {
    switch (edit.kind) {
      case "value": {
        const f = resolved.fields.find((x) => x.key === edit.key);
        if (f) startOverride(f);
        return;
      }
      case "field":
        if (!ownSchemaKeys.includes(edit.key)) return;
        withViewTransition(() => {
          cancelEdits();
          setSchemaEdit(edit.key);
        });
        return;
      case "removeField":
        void removeField(edit.key);
        return;
      case "removeOverride":
        void removeOverride(edit.key);
        return;
      case "removeMixin":
        void saveExtends(mixinKeys.filter((x) => x !== edit.key));
        return;
      case "addField":
        withViewTransition(() => {
          cancelEdits();
          setAddingField(true);
        });
        return;
      case "addMixin":
        setComposeAdding(true);
        return;
      case "rule":
        rulesEditorRef.current?.run(edit.rule);
        return;
      // The JSON view turns editable once the draft is showing.
      case "json":
        return;
    }
  };
  runEditRef.current = runEdit;
  const startEdit = (edit: LiveEdit) =>
    editsFromLive ? editInDraft(edit) : runEdit(edit);
  // Where edits from live go, shown under the sections they edit.
  const liveDraftNote = !editsFromLive ? null : myDraft ? (
    <>
      Edits go to your draft{" "}
      <Link onClick={() => selectRevision(myDraft)}>
        v{revisionNumbers.get(myDraft.id)}
      </Link>
      .
    </>
  ) : (
    "Edits start a new draft."
  );
  const canPublishSelected = canPublishRevisionEntity(
    permissionsUtil,
    "config",
    selectedRevision,
    config,
    revisionPublishEnvironments,
  );
  const showsStatusBar =
    tab === "overview" &&
    hasRevisionStatus(selectedRevision, liveRevision, allRevisions);
  const stickyTop = tabsBottom + (showsStatusBar ? statusBarHeight : 0);

  const newDraft = canDraft ? (
    <NewDraftButton
      entityNoun="Config"
      activeDraftCount={openRevisions.length}
      nextVersion={Math.max(0, ...revisionNumbers.values()) + 1}
      basedOn={
        liveRevision ? (
          <>
            <Text as="span" size="inherit" weight="semibold" color="text-high">
              <RevisionLabel
                version={revisionNumbers.get(liveRevision.id) ?? 1}
                title={liveRevision.title}
                numbered={!!liveRevision.title}
                minWidth={0}
                numberSize="inherit"
              />
            </Text>{" "}
            {getStatusBadge("live", approvalRequired)}
          </>
        ) : (
          <>the live Config</>
        )
      }
      create={async ({ title, comment }) => {
        const res = await apiCall<{ revision?: Revision }>(
          `/configs/${config.id}?forceCreateRevision=1`,
          { method: "PUT", body: JSON.stringify({}) },
        );
        const revision = res?.revision;
        if (!revision) return;
        if (title) {
          await apiCall(`/revision/${revision.id}/title`, {
            method: "PATCH",
            body: JSON.stringify({ title }),
          });
        }
        if (comment) {
          await apiCall(`/revision/${revision.id}/description`, {
            method: "PATCH",
            body: JSON.stringify({ description: comment }),
          });
        }
        await onRevisionCreated(revision);
      }}
    />
  ) : null;

  const menu = (
    <DetailsPageMenu
      open={menuOpen}
      onOpenChange={setMenuOpen}
      disabledReason={editsBlocked}
    >
      <DropdownMenuGroup>
        <DropdownMenuItem
          onClick={() => {
            setMenuOpen(false);
            setShowAuditModal(true);
          }}
        >
          Audit history
        </DropdownMenuItem>
        {allRevisions.length >= 2 && (
          <DropdownMenuItem
            onClick={() => {
              setMenuOpen(false);
              setCompareOpen(true);
            }}
          >
            Compare revisions
          </DropdownMenuItem>
        )}
      </DropdownMenuGroup>
      {((!config.lock && canPublishNow) || !!config.lock) && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {!config.lock ? (
              <DropdownMenuItem
                onClick={() => {
                  setMenuOpen(false);
                  setLockConfirm("lock");
                }}
              >
                Lock…
              </DropdownMenuItem>
            ) : (
              // Always shown while locked; disabled (not hidden) when
              // the viewer lacks unlock permission, so it's discoverable.
              <DropdownMenuItem
                disabled={!canBypassApproval}
                tooltip={
                  !canBypassApproval
                    ? "You don't have permission to unlock this Config."
                    : undefined
                }
                onClick={() => {
                  setMenuOpen(false);
                  setLockConfirm("unlock");
                }}
              >
                Unlock…
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        </>
      )}
      {((!config.experimentGuard && canPublishNow) ||
        !!config.experimentGuard) && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {!config.experimentGuard ? (
              <DropdownMenuItem
                onClick={() => {
                  setMenuOpen(false);
                  handleExperimentGuard(true);
                }}
              >
                Enable experiment guard
              </DropdownMenuItem>
            ) : (
              // Disabling a protection is gated on bypass-approval
              // (matches unlock); shown-but-disabled so it stays
              // discoverable.
              <DropdownMenuItem
                disabled={!canBypassApproval}
                tooltip={
                  !canBypassApproval
                    ? "You don't have permission to disable the experiment guard."
                    : undefined
                }
                onClick={() => {
                  setMenuOpen(false);
                  handleExperimentGuard(false);
                }}
              >
                Disable experiment guard
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        </>
      )}
      {(canArchiveNow || canDeleteNow) && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {canArchiveNow && (
              <DropdownMenuItem
                disabled={isLocked}
                tooltip={
                  config.lock
                    ? `Locked at v${config.lock.version}. Unlock to ${
                        config.archived ? "unarchive" : "archive"
                      }.`
                    : undefined
                }
                onClick={() => {
                  setMenuOpen(false);
                  setShowArchiveModal(true);
                }}
              >
                {/* LIVE state: the endpoint flips against live, so the
                    projected state labels the opposite action. */}
                {config.archived ? "Unarchive" : "Archive"}
              </DropdownMenuItem>
            )}
            {canDeleteNow && (
              <DropdownMenuItem
                color="red"
                onClick={() => {
                  setMenuOpen(false);
                  setConfirmDelete(true);
                }}
              >
                Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        </>
      )}
    </DetailsPageMenu>
  );

  const lineage = (
    <DetailsPanel>
      <PanelSection title={`Configs (${nonFlavorCount})`}>
        <LineageTree
          nodes={data.lineage}
          currentKey={config.key}
          fieldCounts={data.fieldCounts}
          namesByKey={data.configNames}
          archivedByKey={data.archivedByKey}
          // Every Config here with an open draft.
          draftKeys={data.draftByKey}
          extensible={effectiveExtensible}
        />
        {/* Creating an override Config is a create, not an edit of the
            parent — gating it on the parent's draft rights both offered
            an action that fails and hid one create-only users hold. */}
        {!editOpen &&
          permissionsUtil.canCreateConfig({
            project: config.project || "",
          }) && (
            <Box pl="1">
              {hasConfigsFeature ? (
                <Link onClick={() => setShowCreateChild(true)}>
                  <Flex align="center" gap="1">
                    <PiPlus />
                    Add override Config
                  </Flex>
                </Link>
              ) : (
                <PremiumTooltip commercialFeature="feature-configs" usePortal>
                  <Link color="gray">
                    <Flex align="center" gap="1">
                      <PiPlus />
                      Add override Config
                    </Flex>
                  </Link>
                </PremiumTooltip>
              )}
            </Box>
          )}
      </PanelSection>
      {data.composerFamilies?.length ? (
        <>
          <Separator size="4" />
          <PanelSection title="Used as a mixin by">
            {data.composerFamilies.map((fam) => (
              <Box key={fam.rootKey} mb="2">
                <LineageTree
                  nodes={fam.lineage}
                  currentKey={config.key}
                  fieldCounts={data.fieldCounts}
                  namesByKey={data.configNames}
                  archivedByKey={data.archivedByKey}
                  // Every Config here with an open draft.
                  draftKeys={data.draftByKey}
                />
              </Box>
            ))}
          </PanelSection>
        </>
      ) : null}
      <Separator size="4" />
      <PanelSection
        title={
          familyReferences
            ? `Feature Flags (${familyReferences.features.length})`
            : "Feature Flags"
        }
      >
        <ConfigFeatureReferences
          lineage={data.lineage}
          currentKey={config.key}
          references={familyReferences}
          loading={familyReferencesLoading}
          error={(familyReferencesError ?? null) !== null}
        />
      </PanelSection>
    </DetailsPanel>
  );

  const page = (
    <>
      <PageHead
        breadcrumb={[
          { display: "Configs", href: "/configs" },
          { display: displayedConfig.name },
        ]}
      />

      <DetailsPageTitleBar
        title={displayedConfig.name}
        onRename={canEditInfo ? () => setEditInfoOpen("info") : null}
        renameBlockedReason={editLockReason ?? editsBlocked}
        badges={
          <>
            {/* Live state, like the menu's Archive/Unarchive. */}
            {config.archived && <Badge label="Archived" color="gray" />}
            {config.lock && (
              <Tooltip
                content={`Locked at v${config.lock.version}${
                  config.lock.reason ? ` — ${config.lock.reason}` : ""
                }. Drafts can still be edited, but nothing publishes until it's unlocked.`}
              >
                <Badge
                  color="orange"
                  label={
                    <>
                      <PiLockSimple /> {`Locked · v${config.lock.version}`}
                    </>
                  }
                />
              </Tooltip>
            )}
          </>
        }
        actions={
          <DetailsPageActions
            // A draft's way to review is on the status bar under the tabs.
            newDraft={isDraft ? null : newDraft}
            menu={menu}
          />
        }
      >
        <ArchiveStateCallout
          noun="Config"
          liveArchived={!!config.archived}
          viewedArchived={!!displayedConfig.archived}
        />
      </DetailsPageTitleBar>

      <DetailsPageTabs
        value={tab}
        onValueChange={(v) =>
          setTabAndScroll(v as "overview" | "validation" | "review")
        }
        triggers={
          <>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="review">
              Review &amp; Publish
              <ReviewTabCount statuses={allRevisions.map((r) => r.status)} />
            </TabsTrigger>
            <TabsTrigger value="validation">Validation</TabsTrigger>
          </>
        }
        revisionPicker={
          <RevisionDropdown
            entityId={config.id}
            allRevisions={allRevisions}
            selectedRevisionId={selectedRevisionId}
            onSelectRevision={selectRevision}
            requiresApproval={approvalRequired}
            context="header"
            width={REVISION_SELECTOR_WIDTH_PX}
            disabled={!!editsBlocked}
          />
        }
        detailsOpen={details.open}
        setDetailsOpen={details.toggle}
        leftPanel={{
          name: "lineage",
          open: lineagePanel.open,
          setOpen: lineagePanel.toggle,
        }}
        statusBar={
          showsStatusBar ? (
            <div ref={setStatusBarEl}>
              <RevisionStatusBar<ConfigInterface>
                selectedRevision={selectedRevision}
                liveRevision={liveRevision}
                allRevisions={allRevisions}
                liveSnapshot={config}
                diffConfig={REVISION_CONFIG_DIFF_CONFIG}
                entityNoun="Config"
                requiresApproval={selectedRevisionRequiresApproval}
                canDiscard={
                  canDraft || selectedRevision?.authorId === currentUserId
                }
                onSelectRevision={(r) => discardThen(() => selectRevision(r))}
                onReviewPublish={() => setTabAndScroll("review")}
                onPublish={
                  canPublishSelected && !config.lock ? handlePublish : null
                }
                onDiscard={handleDiscard}
                blockedReason={editsBlocked}
              />
            </div>
          ) : null
        }
      />

      <DetailsPanelLayout
        details={details}
        stickyTop={stickyTop}
        leftPanel={{ details: lineagePanel, panel: lineage }}
        minContentWidth={FIELDS_TABLE_MIN_WIDTH_PX + FIELDS_TABLE_CHROME_PX}
        footer={<div ref={setRibbonEl} />}
        panel={
          <ConfigDetailsPanel
            config={displayedConfig}
            parent={
              parentKey
                ? { key: parentKey, name: parentName ?? parentKey }
                : null
            }
            onEditInfo={
              canEditInfo ? (focus) => setEditInfoOpen(focus ?? "info") : null
            }
            editInfoBlockedReason={editLockReason ?? editsBlocked}
            revision={panelRevision}
            allRevisions={allRevisions}
            isLive={!selectedRevision}
            requiresApproval={approvalRequired}
            canEditRevision={canDraft}
            onRenameRevision={async (title) => {
              if (!selectedRevision) return;
              await apiCall(`/revision/${selectedRevision.id}/title`, {
                method: "PATCH",
                body: JSON.stringify({ title }),
              });
              await mutateRevisions();
            }}
            onDescribeRevision={async (description) => {
              if (!selectedRevision) return;
              await apiCall(`/revision/${selectedRevision.id}/description`, {
                method: "PATCH",
                body: JSON.stringify({ description }),
              });
              await mutateRevisions();
            }}
          />
        }
      >
        <div className="details-column">
          <Box className="contents container-fluid pagecontents">
            {/* Row menu actions and opening a draft have no editor to show
                errors in. */}
            {actionError && (
              <Callout status="error" mb="4">
                <MarkdownLinks text={actionError} />
              </Callout>
            )}
            {tab === "overview" && (
              <>
                <SectionFrame
                  title="Fields"
                  description={liveDraftNote}
                  mb="4"
                  stickyTop={stickyTop}
                  tabs={
                    <ConfigEnvTabs
                      currentKey={config.key}
                      currentConfigId={config.id}
                      lineage={data.lineage}
                      configNames={data.configNames}
                      archivedByKey={data.archivedByKey}
                      draftByKey={data.draftByKey}
                      canCreate={
                        !editOpen &&
                        hasConfigsFeature &&
                        permissionsUtil.canCreateConfig({
                          project: config.project || "",
                        })
                      }
                      mutate={mutate}
                    />
                  }
                  actions={
                    <>
                      <SegmentedControl
                        aria-label="View"
                        value={activeTab}
                        setValue={(v) => {
                          // JSON and Resolved share one editor, which keeps its buffer.
                          if (v !== "form" && activeTab !== "form") {
                            setActiveTab(v);
                          } else {
                            discardThen(() => setActiveTab(v));
                          }
                        }}
                        options={[
                          { value: "form", label: "Form" },
                          { value: "json", label: "JSON" },
                          { value: "resolved", label: "Resolved" },
                        ]}
                      />
                      <ConfigExportMenu payloads={exportPayloads} />
                    </>
                  }
                >
                  <Flex direction="column">
                    {activeTab === "form" && (
                      <Box>
                        {canEditInline && (
                          <ReconciledFieldsCallout
                            descendants={reconciliationPreview}
                          />
                        )}
                        {isDraft && (
                          <DescendantImpactCallout
                            nodes={draftDescendantImpact}
                          />
                        )}
                        <FamilyRuleFailuresCallout
                          failures={familyRuleFailures}
                        />
                        <Table
                          variant="ghost"
                          scrollX
                          stickyLastColumn
                          pinScrollbar
                          mt="2"
                          className={clsx(
                            fieldsTableClassName,
                            hideRowMenus && menuColumnHiddenClassName,
                          )}
                          style={{ minWidth: FIELDS_TABLE_MIN_WIDTH_PX }}
                        >
                          <TableHeader>
                            <TableRow>
                              <TableColumnHeader width="200px">
                                Key
                              </TableColumnHeader>
                              <TableColumnHeader>
                                <Flex align="baseline" gap="5">
                                  Value
                                  {overrideCount > 0 && (
                                    <Flex align="center" gap="2">
                                      <Text
                                        as="label"
                                        htmlFor="config-show-overrides"
                                        size="sm"
                                        color="text-low"
                                      >
                                        Show overrides
                                      </Text>
                                      <Switch
                                        id="config-show-overrides"
                                        size="sm"
                                        value={showOverrides}
                                        onChange={setShowOverrides}
                                      />
                                    </Flex>
                                  )}
                                </Flex>
                              </TableColumnHeader>
                              <TableColumnHeader width="110px">
                                Type
                              </TableColumnHeader>
                              <TableColumnHeader width="120px">
                                Source
                              </TableColumnHeader>
                              <TableColumnHeader
                                width={`${USAGE_COLUMN_PX + (hideRowMenus ? MENU_COLUMN_PX : 0)}px`}
                              >
                                <LabelWithHelp
                                  label="Usage"
                                  help="Feature Flag rules and defaults that override this key."
                                />
                              </TableColumnHeader>
                              <TableColumnHeader
                                width={`${MENU_COLUMN_PX}px`}
                              />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {renderExtendsRow()}
                            {renderComposeRow()}

                            {resolved.fields.map((f) => {
                              if (schemaEdit === f.key) {
                                const seed = valueEditSeed(f.field, f.value);
                                return (
                                  <FieldDefForm
                                    key={f.key}
                                    withValue
                                    initial={
                                      ownSchema().fields.find(
                                        (sf) => sf.key === f.key,
                                      ) ?? blankField()
                                    }
                                    initialValue={seed.text}
                                    initialNull={seed.kind === "null"}
                                    existingKeys={resolved.fields.map(
                                      (rf) => rf.key,
                                    )}
                                    constantContext={constantContext}
                                    onDirtyChange={setFieldDirty}
                                    onSavingChange={setEditorSaving}
                                    onCancel={closeEdits}
                                    onSave={saveField}
                                  />
                                );
                              }
                              return (
                                <ConfigFieldRow
                                  key={f.key}
                                  field={f}
                                  configKey={config.key}
                                  isOwnField={ownSchemaKeys.includes(f.key)}
                                  canEditInline={canStartEdits}
                                  constantContext={constantContext}
                                  squashConstants={squashConstants}
                                  editing={editKey === f.key}
                                  editText={editText}
                                  editKind={editKind}
                                  editError={editError}
                                  saving={savingValue}
                                  setEditText={setEditText}
                                  setEditKind={setEditKind}
                                  onStartEdit={() =>
                                    startEdit({ kind: "value", key: f.key })
                                  }
                                  onSubmit={submitOverride}
                                  onCancelEdit={closeEdits}
                                  onEditDefinition={() =>
                                    startEdit({ kind: "field", key: f.key })
                                  }
                                  onRemoveField={() =>
                                    startEdit({
                                      kind: "removeField",
                                      key: f.key,
                                    })
                                  }
                                  onRemoveOverride={() =>
                                    startEdit({
                                      kind: "removeOverride",
                                      key: f.key,
                                    })
                                  }
                                  showParentValue={
                                    showOverrides && isOverrideField(f)
                                  }
                                  parentValue={parentFieldValues.get(f.key)}
                                  hasValidationError={failingFieldInfo.has(
                                    f.key,
                                  )}
                                  validationTooltip={failingFieldInfo
                                    .get(f.key)
                                    ?.join("; ")}
                                  blockedReason={editsBlocked}
                                  keyNotices={[
                                    ...(undeclaredKeys.has(f.key)
                                      ? [
                                          undeclaredKeysNotice(
                                            [f.key],
                                            effectiveExtensible,
                                          ),
                                        ]
                                      : []),
                                    ...(schemaIssuesByKey.has(f.key)
                                      ? [
                                          schemaIssuesNotice(
                                            schemaIssuesByKey.get(f.key) ?? [],
                                          ),
                                        ]
                                      : []),
                                    ...(canEditInline &&
                                    reconciledDescendants.has(f.key)
                                      ? [
                                          reconciledFieldNotice(
                                            reconciledDescendants.get(f.key) ??
                                              [],
                                          ),
                                        ]
                                      : []),
                                  ]}
                                  keyImplementations={implementationsByKey.get(
                                    f.key,
                                  )}
                                />
                              );
                            })}

                            {resolved.fields.length === 0 && !addingField && (
                              <TableRow>
                                <TableCell colSpan={6}>
                                  <Text color="text-low">No fields yet.</Text>
                                </TableCell>
                              </TableRow>
                            )}
                            {addFieldRows}
                          </TableBody>
                        </Table>
                        {renderAddField()}
                        {renderAddMixin()}
                      </Box>
                    )}

                    {/* JSON and Resolved share ONE editor instance (only the `view` prop
                    flips), so the component stays mounted and edit buffers survive. */}
                    {(activeTab === "json" || activeTab === "resolved") && (
                      <ConfigJsonEditor
                        // A revision switch starts it afresh, even when the values match.
                        key={selectedRevisionId ?? "live"}
                        valueJson={displayedConfig.value ?? "{}"}
                        schemaJson={JSON.stringify(ownSchema().fields)}
                        ancestorOwnedKeys={ancestorOwnedKeys}
                        resolvedFields={resolvedFieldsResolved}
                        effectiveSchema={resolved.effectiveSchema}
                        schemaType={ownSchema().type}
                        extensible={effectiveExtensible}
                        constantContext={constantContext}
                        canEdit={canEditInline}
                        view={activeTab === "resolved" ? "preview" : "edit"}
                        parentKey={parentKey}
                        parentName={parentName}
                        renderProjections={displayedConfig.renderProjections}
                        unpublishedFormats={unpublishedFormats}
                        ribbonEl={ribbonEl}
                        onDirtyChange={setJsonDirty}
                        onSavingChange={setEditorSaving}
                        onEditInDraft={
                          editsFromLive
                            ? () => startEdit({ kind: "json" })
                            : undefined
                        }
                        onSave={(value, fields, renderProjections) =>
                          saveSchema(fields, value, renderProjections)
                        }
                      />
                    )}
                  </Flex>
                </SectionFrame>

                {(keyUsage?.implementations?.length ?? 0) > 0 && (
                  <ConfigUsageSection
                    implementations={keyUsage?.implementations ?? []}
                    fieldKeys={resolved.fields.map((f) => f.key)}
                    stickyTop={stickyTop}
                  />
                )}
              </>
            )}

            {tab === "validation" && (
              <>
                {parentKey && baseNode && (
                  <Callout
                    status="info"
                    mb="4"
                    contentAlign="center"
                    action={
                      <LinkButton
                        href={`/configs/${baseNode.key}#validation`}
                        variant="outline"
                        size="sm"
                        color="inherit"
                      >
                        Open base Config
                      </LinkButton>
                    }
                  >
                    Rules and hooks here apply to {displayedConfig.name} and its
                    descendants. Put family-wide ones on {baseNode.name}.
                  </Callout>
                )}
                <ConfigInvariantsEditor
                  // A rule open in its dialog belongs to one revision.
                  key={`${configKey}:${selectedRevisionId}`}
                  invariants={ownSchema().invariants ?? []}
                  inherited={inheritedInvariants}
                  fieldKeys={resolved.fields.map((f) => f.key)}
                  declaredKeys={resolved.effectiveSchema.map((f) => f.key)}
                  resolvedValue={invariantValue}
                  canEdit={canStartEdits}
                  blockedReason={editsBlocked}
                  onEditInDraft={
                    editsFromLive
                      ? (rule) => startEdit({ kind: "rule", rule })
                      : undefined
                  }
                  ref={rulesEditorRef}
                  draftNote={liveDraftNote}
                  onChange={(next) =>
                    saveSchema(ownSchema().fields, undefined, undefined, next)
                  }
                />
                <ConfigCustomHooksSection
                  config={config}
                  canManage={canDraft}
                  lineage={[
                    ...data.lineage,
                    ...(data.composerFamilies ?? []).flatMap((f) => f.lineage),
                  ]}
                />
              </>
            )}

            {tab === "review" && (
              <ReviewAndPublishTab<ConfigInterface>
                revision={panelRevision}
                allRevisions={allRevisions}
                currentState={config}
                diffConfig={REVISION_CONFIG_DIFF_CONFIG}
                entityName={config.name}
                entityNoun="Config"
                requiresApproval={selectedRevisionRequiresApproval}
                reviewRules={reviewRule ? [reviewRule] : []}
                canEditEntity={canDraft}
                canRevertEntity={canRevertEntity}
                canLandRevertEntity={canRevertLandingEntity}
                // Project-scoped, matching the adapter's `canDeleteEntity` and the
                // Constant page: this gates whether a narrow atom may SUBMIT a
                // pure-archive draft, which changes nothing live. Scoped to serving
                // environments it hid the control from a role that could propose the
                // archive perfectly well. Landing it is the env-scoped question, and
                // `canLandArchiveEntity` below is what asks it.
                canDeleteEntity={permissionsUtil.canRevisionAction(
                  "config",
                  "delete",
                  config,
                  NO_ENVIRONMENT_BINDING,
                )}
                // A base Config names no environments, so its scoped footprint is
                // empty and SKIPS the environment check — but archiving one takes
                // it out of service everywhere, which is what the endpoint asks.
                canLandArchiveEntity={canLandArchiveToggle(
                  permissionsUtil,
                  "config",
                  config,
                  archiveFootprintForControl({
                    environments,
                    entity: config,
                    scoped: configPublishEnvironments(config),
                  }),
                )}
                holdsLandingDestination={holdsRevisionDestination(
                  permissionsUtil,
                  "config",
                  "publish",
                  panelRevision,
                  config,
                  configPublishEnvironments(config),
                )}
                canCommentOnEntity={canCommentOnRevisionEntity(
                  permissionsUtil,
                  "config",
                  panelRevision,
                  config,
                )}
                canReviewEntity={canReviewRevisionEntity(
                  permissionsUtil,
                  "config",
                  panelRevision,
                  config,
                  revisionPublishEnvironments,
                )}
                canManageDraftsEntity={permissionsUtil.canRevisionAction(
                  "config",
                  "draft",
                  config,
                )}
                canPublishEntity={canPublishRevisionEntity(
                  permissionsUtil,
                  "config",
                  panelRevision,
                  config,
                  revisionPublishEnvironments,
                )}
                // The basis the CANCEL arm actually uses: the adapter's
                // `canPublishRevision(snapshot)` = the entity's OWN scoped
                // environments, with no destination term and no archive-flip
                // widening. Passing the revision-derived footprint dropped the
                // destination term but kept the widening, so an env-limited
                // publisher on an archive-flipping revision still lost the Cancel
                // button for a schedule the endpoint would let them withdraw.
                canPublishEntityCoarse={permissionsUtil.canRevisionAction(
                  "config",
                  "publish",
                  config,
                  configPublishEnvironments(config),
                )}
                canBypassApproval={canBypassApproval}
                publishBlockedReason={
                  config.lock
                    ? `Locked at v${config.lock.version}. Unlock to publish.`
                    : undefined
                }
                selectRevision={selectRevision}
                onPublish={handlePublish}
                onDiscard={handleDiscard}
                onReopen={handleReopen}
                onRevert={(rev) => {
                  setRevisionToRevert(rev);
                  setConfirmRevert(true);
                }}
                onCompareRevisions={
                  allRevisions.length >= 2
                    ? () => setCompareOpen(true)
                    : undefined
                }
                mutate={async () => {
                  await Promise.all([mutateRevisions(), mutate()]);
                }}
              />
            )}
          </Box>
        </div>
      </DetailsPanelLayout>

      {editInfoOpen && (
        <ConfigModal
          existing={displayedConfig}
          focusDescription={editInfoOpen === "description"}
          revisionCtx={revisionCtx}
          onSaved={async (revision) => {
            await onRevisionCreated(revision);
          }}
          close={() => setEditInfoOpen(false)}
        />
      )}

      {showArchiveModal && (
        <ConfigArchiveModal
          // LIVE state, like the feature page does: the endpoint flips against
          // live, so handing the revision-PROJECTED Config here inverted the
          // action whenever the viewed draft staged the opposite archive state —
          // the modal predicted one atom and submitted the other, and the endpoint
          // saw no transition at all and wrote nothing.
          config={config}
          revisionCtx={revisionCtx}
          onSaved={onRevisionCreated}
          selectFlow={selectRevision}
          close={() => setShowArchiveModal(false)}
        />
      )}

      {compareOpen && (
        <CompareRevisionsModal
          liveEntity={config}
          entityId={config.id}
          diffConfig={REVISION_CONFIG_DIFF_CONFIG}
          allRevisions={allRevisions}
          currentRevisionId={selectedRevisionId}
          onClose={() => setCompareOpen(false)}
          requiresApproval={approvalRequired}
        />
      )}

      {showAuditModal && (
        <AuditHistoryExplorerModal<ConfigInterface>
          entityId={config.id}
          entityName="Config"
          config={{
            entityType: "config",
            includedEvents: ["config.created", "config.updated"],
            alwaysVisibleEvents: ["config.created"],
            labelOnlyEvents: [
              {
                event: "config.deleted",
                getLabel: () => "Deleted",
                alwaysVisible: true,
              },
            ],
            sections: [
              {
                label: "Settings",
                keys: ["name", "owner", "description", "project", "archived"],
                render: renderConstantSettings,
                getBadges: getConstantSettingsBadges,
              },
              {
                label: "Value",
                keys: ["value"],
                render: renderConstantValues,
                getBadges: getConstantValuesBadges,
              },
              {
                label: "Fields",
                keys: ["schema"],
                render: renderConstantSchema,
                getBadges: getConstantSchemaBadges,
              },
            ],
            updateEventNames: ["config.updated"],
            defaultGroupBy: "minute",
            hideFilters: true,
            hiddenLabelSections: [OVERFLOW_SECTION_LABEL],
          }}
          onClose={() => setShowAuditModal(false)}
        />
      )}

      {confirmRevert && revisionToRevert && (
        <ConfigRevertModal
          canRevert={canRevertEntity}
          canLandRevert={canRevertLandingEntity}
          // Recomputed per target: restoring an older snapshot can relocate the
          // entity, and the destination is judged on the state being restored.
          canLandRevertForTarget={(t) => {
            // A revert that flips `archived` takes the Config out of service, or
            // returns it, EVERYWHERE it serves — the footprint the endpoint now
            // requires. The Config's own scope is empty for a base Config, so
            // predicting with it offered "Publish now" for an archive restore the
            // server then refused.
            // The COMPLETE state being restored — snapshot plus its patches — not
            // just this revision's `/archived` patch. A snapshot already archived
            // without the revision touching `/archived` restores an archived Config
            // with no patch to read, and the footprint was missed. Same derivation
            // RevertModal uses.
            const restoredState = applyTopLevelPatchOps(
              t.target.snapshot as Record<string, unknown>,
              t.target.proposedChanges,
            ) as { archived?: boolean };
            const flipsArchive =
              !!restoredState.archived !== !!config?.archived;
            return canLandRevertToTarget(
              permissionsUtil,
              "config",
              config,
              restoredProjectScope(t),
              flipsArchive
                ? archiveFootprintForControl({
                    environments,
                    entity: config ?? {},
                    // A scoped Config binds to its own environments; widening it to
                    // everything it could serve over-demands.
                    scoped: configPublishEnvironments(config),
                  })
                : configPublishEnvironments(config),
            );
          }}
          canLandArchive={canLandArchive}
          canDraft={canDraft}
          config={config}
          revision={revisionToRevert}
          allRevisions={allRevisions}
          diffConfig={REVISION_CONFIG_DIFF_CONFIG}
          revertsBypassApproval={!!settings.revertsBypassApproval}
          approvalRequired={approvalRequired}
          canBypassApproval={canBypassApproval}
          close={() => setConfirmRevert(false)}
          onRevisionCreated={async (rev) => {
            await onRevisionCreated(rev);
            setConfirmRevert(false);
          }}
        />
      )}

      {lockConfirm === "lock" && (
        <ConfigLockModal
          configName={config.name}
          onConfirm={async (reason) => {
            await handleLock(reason);
            setLockConfirm(null);
          }}
          close={() => setLockConfirm(null)}
        />
      )}

      {navigationGuard.pendingHref || navigationGuard.confirmingSwitch ? (
        <ConfirmDialog
          title={
            navigationGuard.pendingHref
              ? "Leave without saving?"
              : "Discard unsaved changes?"
          }
          content={
            navigationGuard.pendingHref
              ? "You have unsaved changes to this Config. Leaving this page discards them."
              : "You have unsaved changes to this Config. Switching away discards them."
          }
          // Staying is the primary action; leaving is the secondary one.
          yesText="Keep editing"
          noText={
            navigationGuard.pendingHref ? "Leave page" : "Discard changes"
          }
          onConfirm={navigationGuard.cancelNavigation}
          onCancel={navigationGuard.confirmNavigation}
          onDismiss={navigationGuard.cancelNavigation}
        />
      ) : null}
      {lockConfirm === "unlock" && (
        <ConfirmDialog
          title={`Unlock "${config.name}"?`}
          content="Changes can be published again."
          yesText="Unlock"
          onConfirm={async () => {
            await handleUnlock();
            setLockConfirm(null);
          }}
          onCancel={() => setLockConfirm(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete "${config.name}"?`}
          content="This permanently deletes the Config. This cannot be undone."
          yesText="Delete"
          color="red"
          onConfirm={async () => {
            // After deleting, land on the nearest config still in this lineage
            // (parent spine, else a mixin base) rather than the list — only the
            // root has nowhere left to go.
            const node = data.lineage.find((n) => n.key === config.key);
            const parentKey = node?.parentKey ?? node?.extendsKeys?.[0] ?? null;
            await apiCall(`/configs/${config.id}`, { method: "DELETE" });
            await mutateDefinitions();
            router.push(parentKey ? `/configs/${parentKey}` : "/configs");
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}

      {showCreateChild && (
        <ConfigModal
          parentKey={config.key}
          close={() => setShowCreateChild(false)}
        />
      )}
    </>
  );
  lastPage.current = page;
  return pageShell(page, false);
}
