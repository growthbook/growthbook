import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import { ConstantInterface } from "shared/types/constant";
import { ConfigInterface } from "shared/types/config";
import { SchemaField, SimpleSchema } from "shared/types/feature";
import {
  Revision,
  applyTopLevelPatchOps,
  getConstantRevisionChange,
} from "shared/enterprise";
import {
  constantRequiresReview,
  getReviewSetting,
  parsePlainJSONObject,
  resolveConfigChain,
  ConfigChainNode,
  simpleToJSONSchema,
  fieldsToTsType,
  fieldsToProto,
  getConfigSubtree,
  computeConfigReconciliationPreview,
  evaluateInvariants,
  invariantRuleFields,
  toCel,
  SchemaProjection,
} from "shared/util";
import {
  buildConstantValueMap,
  resolveConstantRefs,
  ConstantSource,
} from "shared/sdk-versioning";
import { isEqual } from "lodash";
import { Box, Flex, Grid, IconButton } from "@radix-ui/themes";
import { BsThreeDotsVertical } from "react-icons/bs";
import {
  PiPlusBold,
  PiCaretDown,
  PiCheckBold,
  PiCopy,
  PiCaretDoubleLeft,
  PiCaretDoubleRight,
  PiStackBold,
  PiFlag,
} from "react-icons/pi";
import { REVIEW_REQUESTED_STATUSES } from "shared/validators";
import useApi from "@/hooks/useApi";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import Button from "@/ui/Button";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import LoadingOverlay from "@/components/LoadingOverlay";
import PageHead from "@/components/Layout/PageHead";
import Owner from "@/components/Avatar/Owner";
import Markdown from "@/components/Markdown/Markdown";

import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import Metadata from "@/ui/Metadata";
import Callout from "@/ui/Callout";
import ConfirmDialog from "@/ui/ConfirmDialog";
import ConfigJsonEditor from "@/components/Configs/ConfigJsonEditor";
import ConfigInvariantsEditor from "@/components/Configs/ConfigInvariantsEditor";
import SelectField from "@/components/Forms/SelectField";
import Switch from "@/ui/Switch";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import RevisionDropdown from "@/components/Revision/RevisionDropdown";
import RevisionSummaryCard from "@/components/Revision/RevisionSummaryCard";
import ReviewAndPublishTab from "@/components/Revision/ReviewAndPublishTab";
import ArchiveModal from "@/components/Revision/ArchiveModal";
import RevertModal from "@/components/Revision/RevertModal";
import RevisionDraftSelectorForChanges from "@/components/Revision/RevisionDraftSelectorForChanges";
import EditRevisionDescriptionModal from "@/components/Reviews/EditRevisionDescriptionModal";
import { draftStatusTooltip } from "@/components/Reviews/RevisionStatusBadge";
import Tooltip from "@/components/Tooltip/Tooltip";
import CompareRevisionsModal from "@/components/Revision/CompareRevisionsModal";
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
import { useLocalStorage } from "@/hooks/useLocalStorage";
import {
  useConfigFamilyReferences,
  useConstantReferences,
} from "@/hooks/useConstantReferences";
import ConstantReferencesList from "@/components/Constants/ConstantReferencesList";
import { ConstantRevisionContext } from "@/components/Constants/useConstantDraftTarget";
import ConfigModal from "@/components/Configs/ConfigModal";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import LineageTree from "@/components/Configs/LineageTree";
import ConfigFeatureReferences from "@/components/Configs/ConfigFeatureReferences";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import FieldDefForm from "@/components/Configs/FieldDefForm";
import ConfigFieldRow from "@/components/Configs/ConfigFieldRow";
import {
  FIELD_GRID_TEMPLATE,
  ResolvedField,
  LineageNode,
  blankField,
  isJsonField,
  fieldValueType,
  typeDefault,
} from "@/components/Configs/fieldSchema";

type ResolvedResponse = {
  status: number;
  config: ConfigInterface;
  // Lineage chain (base → leaf); re-resolved client-side so a selected draft's
  // proposed value shows in the field table.
  chain: ConfigChainNode[];
  effectiveSchema: SchemaField[];
  // Whether this config family permits extra keys (root policy / org default).
  extensible?: boolean;
  fields: ResolvedField[];
  lineage: LineageNode[];
  // Families that compose this config as a mixin (`extends`), one entry per
  // composing `parent`-spine family. Lets a mixin view render "where am I used"
  // as N trees instead of a lone node. Keyed by the family's spine root.
  composerFamilies?: { rootKey: string; lineage: LineageNode[] }[];
  // Own-value field count per config key (covers mixins outside the family).
  fieldCounts?: Record<string, number>;
  // Display name per config key (covers mixins outside the family).
  configNames?: Record<string, string>;
  // Archived flag per config key (covers mixins outside the family).
  archivedByKey?: Record<string, boolean>;
  // Project-scoped value-map inputs so the field table can squash `@const:`
  // refs client-side. The editor and JSON view keep references raw.
  constants: (Pick<
    ConstantInterface,
    "key" | "type" | "value" | "project" | "archived"
  > & { source: ConstantSource })[];
};

// The strings the Export menu copies. All are derived from the displayed
// revision, so the export is revision-sensitive (drafts export their proposed
// state, the live revision exports live).
type ConfigExportPayloads = {
  ownValue: string;
  resolvedValue: string;
  ownSchemaJson: string;
  ownSchemaTs: string;
  ownSchemaProto: string;
  effectiveSchemaJson: string;
  effectiveSchemaTs: string;
  effectiveSchemaProto: string;
  // Validation rules, empty when the config has none.
  validationJsonLogic: string;
  validationCel: string;
};

// Export-as dropdown, modeled on the review "Copy as" widget: copies the
// config's value/schema to the clipboard in the chosen shape. "Resolved"
// variants walk the inheritance tree (and resolve constants for the value).
function ConfigExportMenu({ payloads }: { payloads: ConfigExportPayloads }) {
  const { performCopy, copySuccess, copySupported } = useCopyToClipboard({
    timeout: 2000,
  });
  if (!copySupported) return null;

  const item = (label: string, description: string | null, text: string) => (
    <DropdownMenuItem
      onClick={() => performCopy(text)}
      style={{ height: "auto" }}
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
        <Button variant="ghost" size="sm">
          <Flex align="center" gap="1">
            {copySuccess ? <PiCheckBold /> : <PiCopy />}
            {/* Fixed width so swapping "Copy Config..." ↔ "Copied!" doesn't
                shift the surrounding layout. */}
            <Box
              style={{ width: 92, textAlign: "center", whiteSpace: "nowrap" }}
            >
              {copySuccess ? "Copied!" : "Copy Config"}
            </Box>
            <PiCaretDown />
          </Flex>
        </Button>
      }
    >
      <DropdownMenuGroup label="Value">
        {item("Config", "This config's own value", payloads.ownValue)}
        {item(
          "Resolved config",
          "Inheritance + constants resolved",
          payloads.resolvedValue,
        )}
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup label="Schema">
        {item("JSON Schema", null, payloads.ownSchemaJson)}
        {item("TypeScript", null, payloads.ownSchemaTs)}
        {item("Protobuf", null, payloads.ownSchemaProto)}
      </DropdownMenuGroup>
      <DropdownMenuGroup label="Resolved schema">
        {item("JSON Schema", null, payloads.effectiveSchemaJson)}
        {item("TypeScript", null, payloads.effectiveSchemaTs)}
        {item("Protobuf", null, payloads.effectiveSchemaProto)}
      </DropdownMenuGroup>
      {payloads.validationJsonLogic && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup label="Validation">
            {item("JSONLogic", null, payloads.validationJsonLogic)}
            {item("CEL", null, payloads.validationCel)}
          </DropdownMenuGroup>
        </>
      )}
    </DropdownMenu>
  );
}

// Fields a config revert can restore (mirrors ConstantRevertModal). `archived`
// is handled separately via an explicit opt-in inside RevertModal.
const CONFIG_REVERTABLE_FIELDS = [
  "name",
  "owner",
  "description",
  "project",
  "value",
  "extends",
  "schema",
  "renderProjections",
] as const satisfies readonly (keyof ConfigInterface)[];

// Count bubble overlaid on the collapsed-rail Configs/Features icons.
const RAIL_BADGE_STYLE: React.CSSProperties = {
  position: "absolute",
  top: -4,
  right: -4,
  minWidth: 15,
  height: 15,
  padding: "0 4px",
  borderRadius: 8,
  background: "var(--accent-9)",
  color: "white",
  fontSize: 9,
  fontWeight: 600,
  lineHeight: "15px",
  textAlign: "center",
};

export default function ConfigDetailPage(): React.ReactElement {
  const router = useRouter();
  const { cfgid } = router.query;
  const configKey = typeof cfgid === "string" ? cfgid : "";

  const { apiCall } = useAuth();
  const {
    configs,
    _configsIncludingArchived: allConfigsForGraph,
    projects,
    mutateDefinitions,
  } = useDefinitions();
  const { organization, hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();

  const [editInfoOpen, setEditInfoOpen] = useState(false);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [confirmRevert, setConfirmRevert] = useState(false);
  const [revisionToRevert, setRevisionToRevert] = useState<Revision | null>(
    null,
  );
  const [editDescriptionModal, setEditDescriptionModal] = useState(false);
  const [tab, setTab] = useState<"overview" | "review">("overview");
  const [userSidebarCollapsed, setUserSidebarCollapsed] =
    useLocalStorage<boolean>("config-lineage-sidebar-collapsed", false);
  const [sidebarTab, setSidebarTab] = useState<"configs" | "features">(
    "configs",
  );
  // The lineage panel auto-rails when the *content container* (not the screen)
  // is too narrow for the panel + review. The main nav skews the viewport, so we
  // measure the actual available width with a ResizeObserver.
  const contentRowRef = useRef<HTMLDivElement>(null);
  const [isNarrowContainer, setIsNarrowContainer] = useState(false);
  // Transient "peek" of the full panel while the container is narrow.
  const [narrowSidebarOpen, setNarrowSidebarOpen] = useState(false);
  useEffect(() => {
    const el = contentRowRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const narrow = el.clientWidth < 900;
      setIsNarrowContainer(narrow);
      if (narrow) setNarrowSidebarOpen(false);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const sidebarCollapsed = isNarrowContainer
    ? !narrowSidebarOpen
    : userSidebarCollapsed;
  const collapseSidebar = () =>
    isNarrowContainer
      ? setNarrowSidebarOpen(false)
      : setUserSidebarCollapsed(true);
  const expandSidebar = () =>
    isNarrowContainer
      ? setNarrowSidebarOpen(true)
      : setUserSidebarCollapsed(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showOverrides, setShowOverrides] = useState(false);
  const [showCreateChild, setShowCreateChild] = useState(false);
  // Whether the inline "compose a mixin config" picker is showing.
  const [composeAdding, setComposeAdding] = useState(false);

  // Field currently being overridden (inline value edit), and the draft text.
  const [activeTab, setActiveTab] = useState<
    "form" | "json" | "resolved" | "validation"
  >("form");
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  // Separate from the text so an explicit null and a concrete value stay
  // distinct. (Not overriding at all is a third axis: the inherit / Reset action.)
  const [editKind, setEditKind] = useState<"value" | "null" | "undefined">(
    "value",
  );

  // Inline schema authoring: "add" shows a blank field form; a key string edits
  // that field's definition.
  const [schemaEdit, setSchemaEdit] = useState<"add" | string | null>(null);

  // Surfaced when a composition (mixin) write fails.
  const [composeError, setComposeError] = useState<string | null>(null);

  // Serializes mixin (`extends`) writes: two quick add/remove clicks each compute
  // `next` from a stale `mixinKeys` snapshot, so without a guard the second write
  // can clobber the first and silently drop (or re-add) a mixin.
  const savingExtendsRef = useRef(false);

  // Switching configs (e.g. via the lineage tree) reuses this page instance, so
  // clear any in-progress row edit / insert when the addressed config changes.
  useEffect(() => {
    setEditKey(null);
    setEditText("");
    setEditError(null);
    setEditKind("value");
    setSchemaEdit(null);
    setShowCreateChild(false);
    setComposeAdding(false);
    setShowOverrides(false);
    // The reused page instance can otherwise carry a modal open from the
    // previous config (e.g. the review/publish dialog popping up after a
    // lineage/tag link lands on a different config).
    setTab("overview");
    setCompareOpen(false);
    setConfirmRevert(false);
    setRevisionToRevert(null);
    setEditDescriptionModal(false);
    setShowArchiveModal(false);
    setShowAuditModal(false);
    setEditInfoOpen(false);
    setConfirmDelete(false);
    setMenuOpen(false);
  }, [configKey]);

  // Addressed by `key`; the resolved endpoint returns the config plus its
  // lineage chain + tree. The selected revision (`?v=` in the URL) is forwarded
  // so a draft's unpublished lineage/composition drives resolution server-side.
  const versionParam = typeof router.query.v === "string" ? router.query.v : "";
  const { data, error, mutate } = useApi<ResolvedResponse>(
    `/configs/${configKey}/resolved${versionParam ? `?v=${versionParam}` : ""}`,
    { shouldRun: () => !!configKey },
  );
  const config = data?.config;

  const {
    selectedRevision,
    selectedRevisionId,
    openRevisions,
    allRevisions,
    selectRevision,
    onRevisionCreated,
    handlePublish,
    handleDiscard,
    handleReopen,
    mutateRevisions,
  } = useConstantRevision(config?.id, mutate, config, "config");

  const { references: familyReferences, loading: familyReferencesLoading } =
    useConfigFamilyReferences(config?.id);

  // On "live" (no explicit selection) fall back to the latest merged revision so
  // the Review tab renders its read-only Live view instead of the empty state.
  const displayRevision = useMemo(() => {
    if (selectedRevision) return selectedRevision;
    return [...allRevisions]
      .filter((r) => r.status === "merged")
      .sort(
        (a, b) =>
          new Date(b.dateUpdated).getTime() - new Date(a.dateUpdated).getTime(),
      )[0];
  }, [selectedRevision, allRevisions]);

  // Drives the count bubble on the "Review & Publish" tab.
  const draftStatusCounts: Partial<Record<string, number>> = {};
  allRevisions.forEach((r) => {
    if ((REVIEW_REQUESTED_STATUSES as readonly string[]).includes(r.status)) {
      draftStatusCounts[r.status] = (draftStatusCounts[r.status] ?? 0) + 1;
    }
  });
  const activeDraftCount = Object.values(draftStatusCounts).reduce<number>(
    (sum, n) => sum + (n ?? 0),
    0,
  );

  // References that block archiving — only fetched while the archive modal is
  // open and we're archiving (unarchiving is never blocked).
  const { references: archiveReferences, loading: archiveReferencesLoading } =
    useConstantReferences(
      showArchiveModal && !config?.archived ? config?.id : null,
      "configs",
    );
  const archiveReferenceCount =
    (archiveReferences?.features.length ?? 0) +
    (archiveReferences?.constants.length ?? 0);

  // Constant-picker scope: cycle-creating keys + this config's own key are
  // scrubbed so a value can't reference back into a cycle.
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

  // Squash `@const:` refs to default values for the table display (cross-project
  // refs scrubbed like the payload). The editor and JSON view keep refs raw.
  const squashConstants = useMemo(() => {
    const map = buildConstantValueMap(data?.constants ?? [], "");
    const project = config?.project || "";
    return (value: unknown): unknown =>
      resolveConstantRefs(value, map, new Set(), undefined, project);
  }, [data?.constants, config?.project]);

  const settings = organization.settings || {};
  const revertsBypassApproval = !!settings.revertsBypassApproval;
  const hasApprovalsFeature = hasCommercialFeature("require-approvals");
  // Creating configs (incl. child override configs) is premium-gated; editing
  // existing ones is not (permissive on license lapse).
  const hasConfigsFeature = hasCommercialFeature("feature-configs");

  // Configs inherit the feature `requireReviews` settings. This rule drives the
  // coarse "is approval configured" gate; per-revision uses constantRequiresReview.
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
    !!selectedRevision &&
    (selectedRevision.status === "draft" ||
      selectedRevision.status === "pending-review" ||
      selectedRevision.status === "changes-requested" ||
      selectedRevision.status === "approved");

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

  // Schema-format options whose backing data differs between the displayed
  // draft and the published config — the editor renders an amber dot on each.
  // A schema change touches every format (all derive from it); a projection's
  // own change (added/removed/renamed) additionally flags that one source.
  const unpublishedFormats = useMemo(() => {
    const set = new Set<string>();
    if (!config || !displayedConfig) return set;
    const schemaChanged = !isEqual(
      displayedConfig.schema ?? null,
      config.schema ?? null,
    );
    if (schemaChanged) {
      set.add("json");
      set.add("typescript");
      set.add("protobuf");
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

  // Re-resolve the chain with this node's displayed (possibly draft) value
  // substituted in, so the field table reflects the revision in view.
  const resolved = useMemo(() => {
    if (!data || !displayedConfig)
      return {
        effectiveSchema: [] as SchemaField[],
        fields: [] as ResolvedField[],
      };
    const chain = data.chain.map((n) =>
      n.key === displayedConfig.key
        ? { ...n, value: displayedConfig.value, schema: displayedConfig.schema }
        : n,
    );
    return resolveConfigChain(chain);
  }, [data, displayedConfig]);

  // Resolved fields with `@const:`/`@config:` refs squashed to their values, for
  // the read-only Resolved tab (which shows the fully-resolved value: inheritance
  // *and* constants). The Form tab squashes per-row separately.
  const resolvedFieldsResolved = useMemo(
    () =>
      resolved.fields.map((f) => ({
        ...f,
        value: f.value === undefined ? undefined : squashConstants(f.value),
      })),
    [resolved.fields, squashConstants],
  );

  // Flat resolved (inherited+own) value object for live invariant feedback —
  // mirrors what the back-end publish gate evaluates (raw values, refs as-is).
  const invariantValue = useMemo(() => {
    const o: Record<string, unknown> = {};
    for (const f of resolved.fields) {
      if (f.value !== undefined) o[f.key] = f.value;
    }
    return o;
  }, [resolved.fields]);

  // Invariants that currently fail against the displayed (draft-aware) value —
  // surfaced on the Form tab too, not just the Validation tab.
  const failingInvariants = useMemo(
    () =>
      evaluateInvariants(
        invariantValue,
        displayedConfig?.schema?.invariants ?? [],
      ),
    [invariantValue, displayedConfig],
  );

  // Field key → messages of the failing rules that reference it, for row-level
  // highlighting in the Form tab.
  const failingFieldInfo = useMemo(() => {
    const map = new Map<string, string[]>();
    const failingNames = new Set(failingInvariants.map((v) => v.name));
    for (const inv of displayedConfig?.schema?.invariants ?? []) {
      if (!failingNames.has(inv.name)) continue;
      for (const key of invariantRuleFields(inv.rule)) {
        map.set(key, [...(map.get(key) ?? []), inv.message]);
      }
    }
    return map;
  }, [failingInvariants, displayedConfig]);

  const parentKey = useMemo(() => {
    const self = data?.lineage.find((n) => n.key === config?.key);
    return self?.parentKey ?? null;
  }, [data?.lineage, config?.key]);

  // Family extensibility ("Allow extra fields"). The flag lives on the root, so
  // a root config reads it draft-aware off the displayed revision; a child uses
  // the server-computed (live) family value. Drives schema `additionalProperties`.
  const effectiveExtensible =
    parentKey === null
      ? (displayedConfig?.extensible ??
        settings.configsExtensibleByDefault ??
        true)
      : (data?.extensible ?? settings.configsExtensibleByDefault ?? true);

  // Per-field value as resolved by the parent chain (this config excluded), so
  // an override row can show the inherited value it replaces.
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

  // Descendants that currently declare a field key this config also declares.
  // Publishing makes this config the owner of those keys, so the cascade strips
  // the redundant definitions from each descendant ("base wins"). Surfaced as an
  // informational Callout. Kept above the loading guard for stable hook order.
  const reconciliationPreview = useMemo(() => {
    if (!data || !displayedConfig)
      return [] as { name: string; keys: string[] }[];
    const ownKeys = (displayedConfig.schema?.fields ?? []).map((sf) => sf.key);
    return computeConfigReconciliationPreview(
      data.lineage,
      displayedConfig.key,
      ownKeys,
    );
  }, [data, displayedConfig]);

  // Clipboard-export strings for the Export menu, derived from the displayed
  // revision (so drafts export their proposed state). Schemas are pretty-printed
  // JSON Schema or TS; the empty schema still emits a valid object schema. Kept
  // above the loading guard so the hook order stays stable.
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

    // Resolved value = inheritance-merged fields (constants squashed), excluding
    // fields with no value set anywhere.
    const resolvedObj: Record<string, unknown> = {};
    for (const f of resolved.fields) {
      if (f.value !== undefined) resolvedObj[f.key] = f.value;
    }

    const ownFields = displayedConfig?.schema?.fields ?? [];
    const ownInvariants = displayedConfig?.schema?.invariants ?? [];
    const validationJsonLogic = ownInvariants.length
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
    // CEL export in the documented `invariants:` YAML shape (rule as a CEL
    // string). JSON.stringify escapes name/rule/message into valid YAML scalars.
    const validationCel = ownInvariants.length
      ? "invariants:\n" +
        ownInvariants
          .map(
            (iv) =>
              `  - name: ${JSON.stringify(iv.name)}\n` +
              `    rule: ${JSON.stringify(toCel(iv.rule))}\n` +
              `    message: ${JSON.stringify(iv.message)}`,
          )
          .join("\n")
      : "";
    return {
      ownValue: prettyJSON(displayedConfig?.value ?? "{}"),
      resolvedValue: JSON.stringify(squashConstants(resolvedObj), null, 2),
      ownSchemaJson: schemaToJson(ownFields),
      ownSchemaTs: fieldsToTsType(ownFields, {
        additionalProperties: effectiveExtensible,
      }),
      ownSchemaProto: fieldsToProto(ownFields, {
        additionalProperties: effectiveExtensible,
      }),
      effectiveSchemaJson: schemaToJson(resolved.effectiveSchema),
      effectiveSchemaTs: fieldsToTsType(resolved.effectiveSchema, {
        additionalProperties: effectiveExtensible,
      }),
      effectiveSchemaProto: fieldsToProto(resolved.effectiveSchema, {
        additionalProperties: effectiveExtensible,
      }),
      validationJsonLogic,
      validationCel,
    };
  }, [
    displayedConfig?.value,
    displayedConfig?.schema,
    resolved,
    effectiveExtensible,
    squashConstants,
  ]);

  if (error) {
    return (
      <div className="container-fluid pagecontents">
        <Callout status="error">{error.message}</Callout>
      </div>
    );
  }
  if (!data || !config || !displayedConfig) {
    return <LoadingOverlay />;
  }

  // Start an empty draft regardless of approval settings.
  const handleNewDraft = async () => {
    const res = await apiCall<{ revision?: Revision }>(
      `/configs/${config.id}?forceCreateRevision=1`,
      { method: "PUT", body: JSON.stringify({}) },
    );
    if (res?.revision) await onRevisionCreated(res.revision);
  };

  const canUpdate = permissionsUtil.canUpdateConfig(config, config);
  const canDeleteNow =
    permissionsUtil.canDeleteConfig(config) && !!config.archived;
  // Editing is only meaningful on the live state or a draft.
  const canEditNow = canUpdate && (!selectedRevision || isDraft);
  // Inline editing is draft-only; the non-draft view shows an "Edit" button
  // (handleEdit) that drops into a draft.
  const canEditInline = canUpdate && isDraft;
  const canBypassApproval = permissionsUtil.canBypassApprovalChecks({
    project: config.project || "",
  });

  const revisionCtx: ConstantRevisionContext = {
    allRevisions,
    openRevisions,
    selectedRevision,
    approvalRequired,
    metadataReviewRequired,
    canBypassApproval,
  };

  const projectName = displayedConfig.project
    ? (projects.find((proj) => proj.id === displayedConfig.project)?.name ??
      displayedConfig.project)
    : "";

  // Own-value object of the currently-displayed config (own fields only).
  const ownValue = (): Record<string, unknown> =>
    parsePlainJSONObject(displayedConfig.value ?? "") ?? {};

  // Inline edits target the selected draft; the forceCreateRevision fallback is
  // defensive and should not be reached (gated by canEditInline).
  const writeQuery = (): string =>
    selectedRevision && isDraft
      ? `?revisionId=${selectedRevision.id}`
      : `?forceCreateRevision=1`;

  const saveValue = async (next: Record<string, unknown>) => {
    const res = await apiCall<{ revision?: Revision }>(
      `/configs/${config.id}${writeQuery()}`,
      { method: "PUT", body: JSON.stringify({ value: JSON.stringify(next) }) },
    );
    await mutate();
    if (res?.revision) await onRevisionCreated(res.revision);
  };

  // Set the composition mixins (the `extends` array). Staged into the draft via
  // the same revision-aware write query as value/schema edits.
  //
  // Serialized via a ref + awaited (see savingExtendsRef above): errors are
  // surfaced instead of becoming unhandled rejections.
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

  // Value override (editKey) and schema add/edit (schemaEdit) are mutually
  // exclusive; both cancelled on tab switch so no editor lingers off-tab.
  const cancelEdits = () => {
    setEditKey(null);
    setEditError(null);
    setSchemaEdit(null);
  };

  const startOverride = (f: ResolvedField) => {
    setSchemaEdit(null);
    setEditError(null);
    // Seed from the resolved value (explicit null, concrete value, or type default).
    // JSON editors accept `null` as literal text, so they never use the null kind.
    const isJson = isJsonField(f.field);
    if (f.value === null && !isJson) {
      setEditKind("null");
      setEditText("");
    } else {
      setEditKind("value");
      const v = f.value !== undefined ? f.value : typeDefault(f.field);
      setEditText(isJson ? JSON.stringify(v, null, 2) : String(v));
    }
    setEditKey(f.key);
  };

  const submitOverride = async () => {
    if (!editKey) return;
    // Unset = omit the key from this config's own value (optional field absent).
    if (editKind === "undefined") {
      const v = { ...ownValue() };
      delete v[editKey];
      try {
        await saveValue(v);
        setEditKey(null);
      } catch (e) {
        setEditError(e instanceof Error ? e.message : "Failed to save value");
      }
      return;
    }
    let parsed: unknown;
    if (editKind === "null") {
      parsed = null;
    } else {
      const field =
        resolved.fields.find((f) => f.key === editKey)?.field ?? null;
      const vt = fieldValueType(field);
      if (vt === "json") {
        try {
          parsed = JSON.parse(editText);
        } catch (e) {
          setEditError(e instanceof Error ? e.message : "Invalid JSON");
          return;
        }
      } else if (vt === "boolean") {
        parsed = editText === "true";
      } else if (vt === "number") {
        const n =
          field?.type === "integer"
            ? parseInt(editText, 10)
            : parseFloat(editText);
        if (Number.isNaN(n)) {
          setEditError("Value must be a number");
          return;
        }
        parsed = n;
      } else {
        parsed = editText;
      }
    }
    // Surface backend rejections (schema violation, conflict) inline — the Save
    // button has no setError, so an unhandled rejection would be swallowed.
    try {
      await saveValue({ ...ownValue(), [editKey]: parsed });
      setEditKey(null);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Failed to save value");
    }
  };

  // The fields this config appends (its own schema); inherited fields aren't editable here.
  const ownSchema = (): SimpleSchema =>
    displayedConfig.schema ?? { type: "object", fields: [] };
  const ownSchemaKeys = ownSchema().fields.map((sf) => sf.key);

  // Effective-schema keys this config does NOT declare itself — owned by an
  // ancestor. Declaring one is a "base wins" collision; valuing one is an override.
  const ancestorOwnedKeys = resolved.effectiveSchema
    .map((sf) => sf.key)
    .filter((k) => !ownSchemaKeys.includes(k));

  // Persist the appended schema (optionally with a value override in the same write).
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
    const valueOverride =
      value !== undefined ? { ...ownValue(), [field.key]: value } : undefined;
    await saveSchema(next, valueOverride);
    setSchemaEdit(null);
  };

  // Remove an own field entirely: drop it from the schema and clear its value.
  const removeField = async (key: string) => {
    const v = ownValue();
    const hadOverride = key in v;
    delete v[key];
    await saveSchema(
      ownSchema().fields.filter((f) => f.key !== key),
      hadOverride ? v : undefined,
    );
  };

  // Remove just this config's override of an inherited field (reverts to the
  // inherited value); the field definition is the parent's, so it's untouched.
  const removeOverride = async (key: string) => {
    const v = ownValue();
    delete v[key];
    await saveValue(v);
  };

  // Compact create row when adding, a button otherwise.
  const renderAddField = () =>
    schemaEdit === "add" ? (
      <FieldDefForm
        key="add"
        withValue
        isNew
        initial={blankField()}
        existingKeys={resolved.fields.map((f) => f.key)}
        constantContext={constantContext}
        onCancel={() => setSchemaEdit(null)}
        onSave={saveField}
      />
    ) : (
      canEditInline &&
      schemaEdit === null && (
        <Box mt="2" py="1">
          <Link
            size="2"
            weight="medium"
            onClick={() => {
              setEditKey(null);
              setSchemaEdit("add");
            }}
          >
            <PiPlusBold style={{ marginRight: 3, verticalAlign: "middle" }} />
            Add field
          </Link>
        </Box>
      )
    );

  // Composition mixins: configs layered on top of the `parent` spine. Candidates
  // exclude self, the parent, current mixins, and this config's own descendants
  // (which would close a cycle). Archived configs are hidden as candidates, but
  // the descendant walk uses the archived-inclusive graph so a cycle through an
  // archived intermediate is still excluded.
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

  // The composition row sits at the top of the field table (above the rows and
  // the "Add field" CTA): a "COMPOSES" label, the mixin configs (removable in a
  // draft), and a "+ Add config mixin" affordance.
  // Top-of-table row showing the `parent` this config extends. Mirrors the
  // compose row but has no actions — the parent is fixed (set at creation), so
  // there's nothing to remove here.
  const renderExtendsRow = () => {
    if (!parentKey) return null;
    const name =
      allConfigsForGraph.find((c) => c.key === parentKey)?.name ?? parentKey;
    return (
      <Grid
        columns={FIELD_GRID_TEMPLATE}
        gapX="5"
        align="start"
        py="2"
        px="3"
        style={{ borderBottom: "1px solid var(--slate-a3)" }}
      >
        <Box style={{ minWidth: 0 }}>
          <Flex align="center" style={{ minHeight: 32 }}>
            <Text
              size="small"
              weight="medium"
              color="text-low"
              textTransform="uppercase"
            >
              Extends
            </Text>
          </Flex>
        </Box>
        <Box style={{ minWidth: 0, gridColumn: "span 3" }}>
          <Flex align="center" gap="3" wrap="wrap" style={{ minHeight: 32 }}>
            <Link href={`/configs/${parentKey}`} size="2">
              {name}
            </Link>
          </Flex>
        </Box>
        {/* No actions: the parent is locked in. */}
        <Box />
      </Grid>
    );
  };

  // Top-of-table row listing the composition mixins, with a right-justified
  // actions menu (matching the field rows). Only shown when mixins exist; the
  // "+ Add config mixin" entry point lives at the bottom by "Add field".
  const renderComposeRow = () => {
    if (mixinKeys.length === 0) return null;
    return (
      <Grid
        columns={FIELD_GRID_TEMPLATE}
        gapX="5"
        align="start"
        py="2"
        px="3"
        style={{ borderBottom: "1px solid var(--slate-a3)" }}
      >
        {/* Key column: row label. */}
        <Box style={{ minWidth: 0 }}>
          <Flex align="center" style={{ minHeight: 32 }}>
            <Text
              size="small"
              weight="medium"
              color="text-low"
              textTransform="uppercase"
            >
              Composes
            </Text>
          </Flex>
        </Box>

        {/* Spans the value/type/source columns: the mixin configs. */}
        <Box style={{ minWidth: 0, gridColumn: "span 3" }}>
          <Flex align="center" gap="3" wrap="wrap" style={{ minHeight: 32 }}>
            {mixinKeys.map((k) => {
              const name =
                allConfigsForGraph.find((c) => c.key === k)?.name ?? k;
              return (
                <Link key={k} href={`/configs/${k}`} size="2">
                  {name}
                </Link>
              );
            })}
          </Flex>
        </Box>

        {/* Actions column: right-justified menu, matching the field rows. */}
        <Flex
          gap="2"
          align="center"
          justify="end"
          style={{ minWidth: 0, minHeight: 32 }}
        >
          {canEditInline && (
            <DropdownMenu
              variant="soft"
              trigger={
                <IconButton
                  variant="ghost"
                  color="gray"
                  radius="full"
                  size="2"
                  highContrast
                >
                  <BsThreeDotsVertical size={16} />
                </IconButton>
              }
              triggerStyle={{ marginRight: 0, marginLeft: 0 }}
              menuPlacement="end"
            >
              {mixinKeys.map((k) => (
                <DropdownMenuItem
                  key={k}
                  color="red"
                  onClick={() => saveExtends(mixinKeys.filter((x) => x !== k))}
                >
                  Remove mixin
                </DropdownMenuItem>
              ))}
            </DropdownMenu>
          )}
        </Flex>
      </Grid>
    );
  };

  // Bottom-of-table entry point for adding a mixin, mirroring "Add field".
  const renderAddMixin = () => {
    if (!canEditInline) return null;
    return composeAdding ? (
      <Box mt="2" py="1" style={{ maxWidth: 380 }}>
        <Flex align="center" gap="3">
          <Box style={{ flex: 1 }}>
            <SelectField
              value=""
              placeholder={
                composeOptions.length
                  ? "Select a config to extend with…"
                  : "No other configs available"
              }
              options={composeOptions}
              autoFocus
              onChange={(v) => {
                setComposeAdding(false);
                if (v) saveExtends([...mixinKeys, v]);
              }}
            />
          </Box>
          <Link size="2" onClick={() => setComposeAdding(false)}>
            Cancel
          </Link>
        </Flex>
        {composeError && (
          <Box
            mt="1"
            style={{ color: "var(--red-11)", fontSize: "var(--font-size-1)" }}
          >
            {composeError}
          </Box>
        )}
      </Box>
    ) : (
      <Box mt="2" py="1">
        <Link size="2" weight="medium" onClick={() => setComposeAdding(true)}>
          <PiPlusBold style={{ marginRight: 3, verticalAlign: "middle" }} />
          Add config mixin
        </Link>
        {composeError && (
          <Box
            mt="1"
            style={{ color: "var(--red-11)", fontSize: "var(--font-size-1)" }}
          >
            {composeError}
          </Box>
        )}
      </Box>
    );
  };

  // An override = an inherited field re-valued by this config (not one of its
  // own schema fields).
  const isOverrideField = (f: ResolvedField) =>
    f.source === config.key && !ownSchemaKeys.includes(f.key);
  const overrideCount = resolved.fields.filter(isOverrideField).length;
  const parentNode = parentKey
    ? data.lineage.find((n) => n.key === parentKey)
    : null;
  const parentName = parentKey ? (parentNode?.name ?? parentKey) : null;

  return (
    <>
      <PageHead
        breadcrumb={[
          { display: "Configs", href: "/configs" },
          { display: displayedConfig.name },
        ]}
      />
      <Box className="contents container-fluid pagecontents" mt="2">
        <Flex gap="6" align="start" ref={contentRowRef}>
          {/* Sidebar — the lineage family (Configs) and the features that
              reference it (Features). */}
          <Box
            style={{
              width: sidebarCollapsed ? 48 : 220,
              flexShrink: 0,
              position: "sticky",
              top: "1rem",
              alignSelf: "flex-start",
              maxHeight: "calc(100vh - 2rem)",
              overflowY: "auto",
              transition: "width 0.2s ease",
            }}
          >
            {sidebarCollapsed ? (
              <Flex direction="column" align="center" gap="3" pt="1">
                <Tooltip body="Expand panel">
                  <IconButton
                    variant="ghost"
                    color="gray"
                    size="2"
                    radius="full"
                    onClick={expandSidebar}
                  >
                    <PiCaretDoubleRight size={16} />
                  </IconButton>
                </Tooltip>
                <Tooltip body={`Configs (${data.lineage.length})`}>
                  <IconButton
                    variant="ghost"
                    color="gray"
                    size="2"
                    style={{ position: "relative", overflow: "visible" }}
                    onClick={() => {
                      setSidebarTab("configs");
                      expandSidebar();
                    }}
                  >
                    <PiStackBold size={18} />
                    <span style={RAIL_BADGE_STYLE}>{data.lineage.length}</span>
                  </IconButton>
                </Tooltip>
                <Tooltip
                  body={`Features (${familyReferences?.features.length ?? 0})`}
                >
                  <IconButton
                    variant="ghost"
                    color="gray"
                    size="2"
                    style={{ position: "relative", overflow: "visible" }}
                    onClick={() => {
                      setSidebarTab("features");
                      expandSidebar();
                    }}
                  >
                    <PiFlag size={18} />
                    {!!familyReferences?.features.length && (
                      <span style={RAIL_BADGE_STYLE}>
                        {familyReferences.features.length}
                      </span>
                    )}
                  </IconButton>
                </Tooltip>
              </Flex>
            ) : (
              <>
                <Flex justify="end" mb="1">
                  <Tooltip body="Collapse panel">
                    <IconButton
                      variant="ghost"
                      color="gray"
                      size="1"
                      onClick={collapseSidebar}
                    >
                      <PiCaretDoubleLeft size={15} />
                    </IconButton>
                  </Tooltip>
                </Flex>
                <Tabs
                  value={sidebarTab}
                  onValueChange={(v) =>
                    setSidebarTab(v === "features" ? "features" : "configs")
                  }
                >
                  <TabsList size="1">
                    <TabsTrigger value="configs">
                      <Flex as="span" align="center" gap="2">
                        Configs
                        <Badge
                          size="xs"
                          color="gray"
                          radius="full"
                          label={`${data.lineage.length}`}
                          style={{
                            justifyContent: "center",
                            textAlign: "center",
                          }}
                        />
                      </Flex>
                    </TabsTrigger>
                    <TabsTrigger value="features">
                      <Flex as="span" align="center" gap="2">
                        Features
                        <Badge
                          size="xs"
                          color="gray"
                          radius="full"
                          label={`${familyReferences?.features.length ?? 0}`}
                          style={{
                            justifyContent: "center",
                            textAlign: "center",
                          }}
                        />
                      </Flex>
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="configs">
                    <Box mt="2">
                      <LineageTree
                        nodes={data.lineage}
                        currentKey={config.key}
                        fieldCounts={data.fieldCounts}
                        namesByKey={data.configNames}
                        archivedByKey={data.archivedByKey}
                        // Only the local/active draft is merged into the tree, so flag
                        // just this node when a draft revision is in view.
                        draftKeys={isDraft ? { [config.key]: true } : undefined}
                      />
                    </Box>
                    {canUpdate && (
                      <Box mt="3" pl="1">
                        {hasConfigsFeature ? (
                          <Link
                            size="2"
                            weight="medium"
                            onClick={() => setShowCreateChild(true)}
                          >
                            <PiPlusBold
                              style={{
                                marginRight: 3,
                                verticalAlign: "middle",
                              }}
                            />
                            Add override config
                          </Link>
                        ) : (
                          <PremiumTooltip commercialFeature="feature-configs">
                            <Link size="2" weight="medium" color="gray">
                              <PiPlusBold
                                style={{
                                  marginRight: 3,
                                  verticalAlign: "middle",
                                }}
                              />
                              Add override config
                            </Link>
                          </PremiumTooltip>
                        )}
                      </Box>
                    )}
                    {!!data.composerFamilies?.length && (
                      <Box mt="4">
                        <Text
                          as="div"
                          size="small"
                          weight="medium"
                          color="text-low"
                          ml="1"
                          mb="1"
                        >
                          Used as a mixin by
                        </Text>
                        {data.composerFamilies.map((fam) => (
                          <Box key={fam.rootKey} mb="2">
                            <LineageTree
                              nodes={fam.lineage}
                              currentKey={config.key}
                              fieldCounts={data.fieldCounts}
                              namesByKey={data.configNames}
                              archivedByKey={data.archivedByKey}
                              // The mixin row in each composer tree is this config,
                              // so flag it as a draft when a draft revision is in view.
                              draftKeys={
                                isDraft ? { [config.key]: true } : undefined
                              }
                            />
                          </Box>
                        ))}
                      </Box>
                    )}
                  </TabsContent>
                  <TabsContent value="features">
                    <Box mt="2">
                      <ConfigFeatureReferences
                        lineage={data.lineage}
                        currentKey={config.key}
                        references={familyReferences}
                        loading={familyReferencesLoading}
                      />
                    </Box>
                  </TabsContent>
                </Tabs>
              </>
            )}
          </Box>

          {/* Main */}
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Flex align="start" justify="between" gap="2" mb="2">
              <Box style={{ marginTop: "-4px" }}>
                <Flex align="center" gap="3">
                  <Heading size="x-large" as="h1" mb="0">
                    {displayedConfig.name}
                  </Heading>
                  {displayedConfig.archived && (
                    <Badge label="Archived" color="gray" />
                  )}
                </Flex>
                {parentKey && (
                  <Metadata
                    label="Extends"
                    style={{ marginTop: "var(--space-1)" }}
                    value={
                      <Link href={`/configs/${parentKey}`}>{parentName}</Link>
                    }
                  />
                )}
              </Box>
              <Flex align="center" gap="4" pr="2">
                <RevisionDropdown
                  entityId={config.id}
                  allRevisions={allRevisions}
                  selectedRevisionId={selectedRevisionId}
                  onSelectRevision={selectRevision}
                  requiresApproval={approvalRequired}
                  context="header"
                />
                <DropdownMenu
                  trigger={
                    <IconButton
                      variant="ghost"
                      color="gray"
                      radius="full"
                      size="2"
                      highContrast
                    >
                      <BsThreeDotsVertical size={16} />
                    </IconButton>
                  }
                  open={menuOpen}
                  onOpenChange={setMenuOpen}
                  menuPlacement="end"
                >
                  <DropdownMenuGroup>
                    {canEditNow && (
                      <DropdownMenuItem
                        onClick={() => {
                          setMenuOpen(false);
                          setEditInfoOpen(true);
                        }}
                      >
                        Edit information
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onClick={() => {
                        setMenuOpen(false);
                        setShowAuditModal(true);
                      }}
                    >
                      Audit history
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  {(canEditNow || canDeleteNow) && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        {canEditNow && (
                          <DropdownMenuItem
                            onClick={() => {
                              setMenuOpen(false);
                              setShowArchiveModal(true);
                            }}
                          >
                            {displayedConfig.archived ? "Unarchive" : "Archive"}
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
                </DropdownMenu>
              </Flex>
            </Flex>

            <Flex align="center" gap="4" mb="4" wrap="wrap">
              <Metadata label="Key" value={config.key} />
              <Metadata label="Project" value={projectName || "All projects"} />
              <Box>
                <Text weight="medium">Owner: </Text>
                <Owner ownerId={displayedConfig.owner} gap="1" />
              </Box>
            </Flex>

            {displayedConfig.description && (
              <Box mb="3">
                <Markdown>{displayedConfig.description}</Markdown>
              </Box>
            )}

            <Box mb="4">
              <Tabs
                value={tab}
                onValueChange={(v) => setTab(v as "overview" | "review")}
              >
                <TabsList>
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="review">
                    Review &amp; Publish
                    {activeDraftCount > 0 && (
                      <Tooltip body={draftStatusTooltip(draftStatusCounts)}>
                        <Badge
                          label={String(activeDraftCount)}
                          color="red"
                          variant="solid"
                          radius="full"
                          ml="2"
                          style={{ minWidth: 18, height: 18 }}
                        />
                      </Tooltip>
                    )}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </Box>

            {tab === "overview" && (
              <>
                <RevisionSummaryCard
                  allRevisions={allRevisions}
                  selectedRevision={selectedRevision}
                  entityNoun="config"
                  hasRevisions={allRevisions.length > 0}
                  canEditTitle={canUpdate}
                  canEditDescription={canUpdate}
                  fallbackOwnerId={config.owner}
                  fallbackDateCreated={config.dateCreated}
                  onSelectRevision={selectRevision}
                  onTitleCommit={async (revisionId, title) => {
                    await apiCall(`/revision/${revisionId}/title`, {
                      method: "PATCH",
                      body: JSON.stringify({ title }),
                    });
                    await mutateRevisions();
                  }}
                  onNewDraft={canUpdate ? handleNewDraft : undefined}
                  onReviewPublish={() => setTab("review")}
                  onEditDescription={() => setEditDescriptionModal(true)}
                  promptDraftWhenLive
                />

                <Box mb="4" pb="5" px="6" className="appbox">
                  <Tabs
                    value={activeTab}
                    onValueChange={(v) => {
                      cancelEdits();
                      setActiveTab(
                        v === "json"
                          ? "json"
                          : v === "resolved"
                            ? "resolved"
                            : v === "validation"
                              ? "validation"
                              : "form",
                      );
                    }}
                  >
                    {/* Single tab bar with consistent meanings on every revision:
                    Form/JSON show this config's own definition (editable only on
                    a draft); Resolved is the read-only resolved value + effective
                    schema after inheritance/constants. The right-hand controls
                    live inside the (full-width) TabsList so its underline runs
                    the whole width of the appbox and sits under them too. */}
                    <Box pt="4" mb="4">
                      <TabsList style={{ width: "100%" }}>
                        <TabsTrigger value="form">Form</TabsTrigger>
                        <TabsTrigger value="json">JSON</TabsTrigger>
                        <TabsTrigger value="resolved">Resolved</TabsTrigger>
                        <TabsTrigger value="validation">Validation</TabsTrigger>
                        {/* stopPropagation so the interactive controls don't feed
                        the TabsList's arrow-key roving focus. */}
                        <Flex
                          align="center"
                          gap="5"
                          ml="auto"
                          pl="4"
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <ConfigExportMenu payloads={exportPayloads} />
                        </Flex>
                      </TabsList>
                    </Box>

                    {/* Form — per-field resolved values (override / reset). */}
                    <TabsContent value="form">
                      <Box>
                        {canEditInline && reconciliationPreview.length > 0 && (
                          <Callout status="info" mt="3">
                            Publishing will remove{" "}
                            {reconciliationPreview
                              .map(
                                (h) =>
                                  `${h.keys.map((k) => `"${k}"`).join(", ")} from ${h.name}`,
                              )
                              .join("; ")}{" "}
                            — this config now defines{" "}
                            {reconciliationPreview.length === 1 &&
                            reconciliationPreview[0].keys.length === 1
                              ? "that field"
                              : "those fields"}
                            , so the descendant keeps only a value override
                            (base wins).
                          </Callout>
                        )}
                        <Box style={{ minWidth: 800 }}>
                          {/* Column header — same grid template as the rows so it
                      aligns. The 5th (actions) column holds the right-aligned
                      "Show overrides" toggle. */}
                          <Grid
                            columns={FIELD_GRID_TEMPLATE}
                            gapX="5"
                            align="start"
                            pt="3"
                            pb="1"
                            px="3"
                            style={{
                              borderBottom: "1px solid var(--slate-a4)",
                              position: "sticky",
                              // Pin just below the fixed 56px top nav (.topbar) — the
                              // page scrolls the document, so top:0 would hide the
                              // header behind the nav.
                              top: 56,
                              zIndex: 2,
                              background: "var(--color-panel-solid)",
                            }}
                          >
                            {["Key", "Value", "Type", "Source"].map((label) => (
                              <Box key={label} style={{ minWidth: 0 }}>
                                <Flex align="center" style={{ minHeight: 24 }}>
                                  <Text
                                    size="small"
                                    weight="medium"
                                    color="text-low"
                                    textTransform="uppercase"
                                  >
                                    {label}
                                  </Text>
                                </Flex>
                              </Box>
                            ))}
                            <Flex
                              align="center"
                              justify="end"
                              style={{ minHeight: 24 }}
                            >
                              {overrideCount > 0 && (
                                <Switch
                                  value={showOverrides}
                                  onChange={setShowOverrides}
                                  label="Show overrides"
                                />
                              )}
                            </Flex>
                          </Grid>

                          {renderExtendsRow()}
                          {renderComposeRow()}

                          {resolved.fields.map((f) => {
                            // Editing an own field replaces the row with the full editor
                            // (definition + value); the value is seeded from the resolved
                            // value, mirroring the inherited-field value editor.
                            if (schemaEdit === f.key) {
                              const isJson = isJsonField(f.field);
                              // JSON editors accept `null` as literal text, so only
                              // non-JSON fields use the null flag/checkbox.
                              const seedNull = f.value === null && !isJson;
                              const seedVal =
                                f.value !== undefined && f.value !== null
                                  ? f.value
                                  : typeDefault(f.field);
                              return (
                                <FieldDefForm
                                  key={f.key}
                                  withValue
                                  initial={
                                    ownSchema().fields.find(
                                      (sf) => sf.key === f.key,
                                    ) ?? blankField()
                                  }
                                  initialValue={
                                    seedNull
                                      ? ""
                                      : isJson
                                        ? JSON.stringify(
                                            f.value !== undefined
                                              ? f.value
                                              : seedVal,
                                            null,
                                            2,
                                          )
                                        : String(seedVal)
                                  }
                                  initialNull={seedNull}
                                  existingKeys={resolved.fields.map(
                                    (rf) => rf.key,
                                  )}
                                  constantContext={constantContext}
                                  onCancel={() => setSchemaEdit(null)}
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
                                canEditInline={canEditInline}
                                constantContext={constantContext}
                                squashConstants={squashConstants}
                                editing={editKey === f.key}
                                editText={editText}
                                editKind={editKind}
                                editError={editError}
                                setEditText={setEditText}
                                setEditKind={setEditKind}
                                onStartEdit={() => startOverride(f)}
                                onSubmit={submitOverride}
                                onCancelEdit={() => setEditKey(null)}
                                onEditDefinition={() => {
                                  setEditKey(null);
                                  setSchemaEdit(f.key);
                                }}
                                onRemoveField={() => removeField(f.key)}
                                onRemoveOverride={() => removeOverride(f.key)}
                                showParentValue={
                                  showOverrides && isOverrideField(f)
                                }
                                parentValue={parentFieldValues.get(f.key)}
                                hasValidationError={failingFieldInfo.has(f.key)}
                                validationTooltip={failingFieldInfo
                                  .get(f.key)
                                  ?.join("; ")}
                              />
                            );
                          })}

                          {resolved.fields.length === 0 &&
                            schemaEdit !== "add" && (
                              <Text
                                as="p"
                                size="small"
                                color="text-low"
                                mt="3"
                                mb="1"
                              >
                                No fields yet.
                              </Text>
                            )}
                          {renderAddField()}
                          {renderAddMixin()}
                        </Box>
                      </Box>
                    </TabsContent>

                    {/* JSON (own value + schema; editable only on a draft) and
                    Resolved (resolved value + effective schema, read-only) share
                    ONE editor instance at a fixed tree position, so switching
                    between them only flips the `view` prop — the component stays
                    mounted and edit buffers survive. */}
                    {(activeTab === "json" || activeTab === "resolved") && (
                      <ConfigJsonEditor
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
                        onSave={(value, fields, renderProjections) =>
                          saveSchema(fields, value, renderProjections)
                        }
                      />
                    )}

                    {activeTab === "validation" && (
                      <Box pt="4">
                        <ConfigInvariantsEditor
                          invariants={ownSchema().invariants ?? []}
                          // All resolved keys (declared schema fields + value
                          // keys), so rules can reference schema-less configs too.
                          fieldKeys={resolved.fields.map((f) => f.key)}
                          resolvedValue={invariantValue}
                          canEdit={canEditInline}
                          onChange={(next) =>
                            saveSchema(
                              ownSchema().fields,
                              undefined,
                              undefined,
                              next,
                            )
                          }
                        />
                      </Box>
                    )}
                  </Tabs>
                </Box>
              </>
            )}

            {tab === "review" && (
              <ReviewAndPublishTab<ConfigInterface>
                revision={selectedRevision ?? displayRevision ?? null}
                allRevisions={allRevisions}
                currentState={config}
                diffConfig={REVISION_CONFIG_DIFF_CONFIG}
                entityName={config.name}
                entityNoun="config"
                requiresApproval={selectedRevisionRequiresApproval}
                canEditEntity={canUpdate}
                canBypassApproval={canBypassApproval}
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
        </Flex>
      </Box>

      {editInfoOpen && (
        <ConfigModal
          existing={displayedConfig}
          revisionCtx={revisionCtx}
          onSaved={async (revision) => {
            await onRevisionCreated(revision);
          }}
          close={() => setEditInfoOpen(false)}
        />
      )}

      {showArchiveModal && (
        <ArchiveModal
          entityNoun="Config"
          entityId={config.id}
          isArchived={!!config.archived}
          apiPathBase="/configs"
          openRevisions={openRevisions}
          approvalRequired={approvalRequired}
          canBypassApproval={canBypassApproval}
          referenceCount={archiveReferenceCount}
          referencesLoading={archiveReferencesLoading}
          referencesList={
            <ConstantReferencesList
              features={archiveReferences?.features ?? []}
              constants={archiveReferences?.constants ?? []}
            />
          }
          renderDraftSelector={({
            mode,
            setMode,
            selectedDraftId,
            setSelectedDraftId,
            canAutoPublish,
            approvalRequired: gated,
          }) => (
            <RevisionDraftSelectorForChanges
              entityId={config.id}
              openRevisions={openRevisions}
              allRevisions={allRevisions}
              mode={mode}
              setMode={setMode}
              selectedDraftId={selectedDraftId}
              setSelectedDraftId={setSelectedDraftId}
              canAutoPublish={canAutoPublish}
              approvalRequired={gated}
            />
          )}
          trackingEventModalType="config-archive-modal"
          close={() => setShowArchiveModal(false)}
          onRevisionCreated={onRevisionCreated}
          selectFlow={selectRevision}
          onSaved={mutateDefinitions}
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
          mutate={async () => {
            await Promise.all([mutateRevisions(), mutate()]);
          }}
          requiresApproval={approvalRequired}
        />
      )}

      {confirmRevert && revisionToRevert && (
        <RevertModal<ConfigInterface>
          liveEntity={config}
          revertableFields={CONFIG_REVERTABLE_FIELDS}
          apiPathBase="/configs"
          revision={revisionToRevert}
          allRevisions={allRevisions}
          diffConfig={REVISION_CONFIG_DIFF_CONFIG}
          revertsBypassApproval={revertsBypassApproval}
          approvalRequired={approvalRequired}
          canBypassApproval={canBypassApproval}
          renderDraftSelector={({
            mode,
            setMode,
            canAutoPublish,
            approvalRequired: gated,
          }) => (
            <RevisionDraftSelectorForChanges
              entityId={config.id}
              openRevisions={[]}
              allRevisions={allRevisions}
              mode={mode}
              setMode={setMode}
              selectedDraftId={null}
              setSelectedDraftId={() => undefined}
              canAutoPublish={canAutoPublish}
              approvalRequired={gated}
              hideExisting
              defaultExpanded
              triggerPrefix="Revert will be"
            />
          )}
          close={() => {
            setConfirmRevert(false);
            setRevisionToRevert(null);
          }}
          onRevisionCreated={async (rev) => {
            await onRevisionCreated(rev);
            setConfirmRevert(false);
            setRevisionToRevert(null);
          }}
        />
      )}

      {editDescriptionModal && displayRevision && (
        <EditRevisionDescriptionModal
          initialValue={displayRevision.comment || ""}
          close={() => setEditDescriptionModal(false)}
          onSubmit={async (description) => {
            await apiCall(`/revision/${displayRevision.id}/description`, {
              method: "PATCH",
              body: JSON.stringify({ description }),
            });
            await Promise.all([mutateRevisions(), mutate()]);
          }}
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

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete "${config.name}"?`}
          content="This permanently deletes the config. This cannot be undone."
          yesText="Delete"
          onConfirm={async () => {
            await apiCall(`/configs/${config.id}`, { method: "DELETE" });
            await mutateDefinitions();
            router.push("/configs");
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
}
