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
  fieldsToGolang,
  fieldsToRust,
  fieldsToPython,
  getConfigSubtree,
  computeConfigReconciliationPreview,
  evaluateInvariants,
  invariantRuleFields,
  isScopedConfig,
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
  PiLockSimple,
  PiInfo,
} from "react-icons/pi";
import useApi from "@/hooks/useApi";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import Button from "@/ui/Button";
import SplitButton from "@/ui/SplitButton";
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
import HelperText from "@/ui/HelperText";
import ConfirmDialog from "@/ui/ConfirmDialog";
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
import RevisionSummaryCard from "@/components/Revision/RevisionSummaryCard";
import ReviewAndPublishTab from "@/components/Revision/ReviewAndPublishTab";
import CompareRevisionsModal from "@/components/Revision/CompareRevisionsModal";
import EditRevisionDescriptionModal from "@/components/Reviews/EditRevisionDescriptionModal";
import { draftStatusTooltip } from "@/components/Reviews/RevisionStatusBadge";
import Tooltip from "@/components/Tooltip/Tooltip";
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
import ConfigFeatureReferences from "@/components/Configs/ConfigFeatureReferences";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import FieldDefForm from "@/components/Configs/FieldDefForm";
import ConfigFieldRow from "@/components/Configs/ConfigFieldRow";
import ConfigInvariantsEditor from "@/components/Configs/ConfigInvariantsEditor";
import ConfigCustomHooksSection from "@/components/Configs/ConfigCustomHooksSection";
import ConfigUsageSection from "@/components/Configs/ConfigUsageSection";
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
  // The editor and JSON view keep references raw; this drives `@const:` squashing in the table.
  constants: (Pick<
    ConstantInterface,
    "key" | "type" | "value" | "project" | "archived"
  > & { source: ConstantSource })[];
};

const SCHEMA_EXPORT_FORMATS: { id: string; label: string }[] = [
  { id: "json", label: "JSON Schema" },
  { id: "typescript", label: "TypeScript" },
  { id: "protobuf", label: "Protobuf" },
  { id: "python", label: "Python" },
  { id: "go", label: "Go" },
  { id: "rust", label: "Rust" },
];

const SCHEMA_LANG_LABEL: Record<string, string> = {
  typescript: "TypeScript",
  protobuf: "Protobuf",
  python: "Python",
  go: "Go",
  rust: "Rust",
  "json-schema": "JSON Schema",
};

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
        <Button variant="outline" size="sm">
          <Flex align="center" gap="1">
            {copySuccess ? <PiCheckBold /> : <PiCopy />}
            {/* Fixed width so the "Copied!" swap doesn't shift layout. */}
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
      <DropdownSubMenu trigger="Schema">
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
      <DropdownSubMenu trigger="Resolved schema">
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
    projects,
    mutateDefinitions,
  } = useDefinitions();
  const { organization, hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();

  const [editInfoOpen, setEditInfoOpen] = useState(false);
  const [confirmRevert, setConfirmRevert] = useState(false);
  const [revisionToRevert, setRevisionToRevert] = useState<Revision | null>(
    null,
  );
  const [editDescriptionModal, setEditDescriptionModal] = useState(false);
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
  // Delete failures fire from a row's action menu (not its editing state), so
  // they can't use the editing-only `editError` slot — surfaced section-level.
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Separate from the text so an explicit null and a concrete value stay distinct
  // (not overriding at all is a third axis: the inherit / Reset action).
  const [editKind, setEditKind] = useState<"value" | "null" | "undefined">(
    "value",
  );

  // "add" shows a blank field form; a key string edits that field's definition.
  const [schemaEdit, setSchemaEdit] = useState<"add" | string | null>(null);

  const [composeError, setComposeError] = useState<string | null>(null);

  // Serializes mixin (`extends`) writes: without it, two quick clicks each compute
  // `next` from a stale snapshot and the second clobbers the first.
  const savingExtendsRef = useRef(false);

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
    setTab(newTab);
    router.replace(
      { pathname: router.pathname, query: router.query, hash: newTab },
      undefined,
      { shallow: true },
    );
  };

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
    openRevisions,
    allRevisions,
    selectRevision,
    onRevisionCreated,
    handlePublish,
    handleDiscard,
    handleReopen,
    mutateRevisions,
  } = useConstantRevision(config?.id, mutate, config, "config");

  // With no draft selected, fall back to the live (most-recently-merged) revision
  // so the review tab renders its read-only Live view instead of the "select a
  // revision" empty state, matching constants and saved groups.
  const displayRevision = useMemo(() => {
    if (selectedRevision) return selectedRevision;
    return [...allRevisions]
      .filter((r) => r.status === "merged")
      .sort(
        (a, b) =>
          new Date(b.dateUpdated).getTime() - new Date(a.dateUpdated).getTime(),
      )[0];
  }, [selectedRevision, allRevisions]);

  // The page instance is reused across configs (and the selected revision can
  // change under an open editor), so clear in-progress edits when either changes.
  useEffect(() => {
    setEditKey(null);
    setEditText("");
    setEditError(null);
    setComposeError(null);
    setEditKind("value");
    setSchemaEdit(null);
    setShowCreateChild(false);
    setComposeAdding(false);
    setShowOverrides(false);
    // Also close any modal carried over from the previous config.
    setCompareOpen(false);
    setConfirmRevert(false);
    setEditDescriptionModal(false);
    setShowArchiveModal(false);
    setShowAuditModal(false);
    setEditInfoOpen(false);
    setConfirmDelete(false);
    setMenuOpen(false);
  }, [configKey, selectedRevisionId]);

  // Open-draft counts by status, for the Review & Publish tab badge tooltip.
  const draftStatusCounts: Partial<Record<string, number>> = {};
  for (const r of openRevisions) {
    draftStatusCounts[r.status] = (draftStatusCounts[r.status] ?? 0) + 1;
  }

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

  // For the read-only Resolved tab (inheritance *and* constants); the Form tab squashes per-row.
  const resolvedFieldsResolved = useMemo(
    () =>
      resolved.fields.map((f) => ({
        ...f,
        value: f.value === undefined ? undefined : squashConstants(f.value),
      })),
    [resolved.fields, squashConstants],
  );

  // The resolved (inherited+own) value object cross-field rules run against —
  // present keys only, mirroring the back-end publish gate (raw values, refs
  // as-is).
  const invariantValue = useMemo(() => {
    const o: Record<string, unknown> = {};
    for (const f of resolved.fields) {
      if (f.value !== undefined) o[f.key] = f.value;
    }
    return o;
  }, [resolved.fields]);

  // Invariants that currently fail against the displayed (draft-aware) value.
  const failingInvariants = useMemo(
    () =>
      evaluateInvariants(
        invariantValue,
        displayedConfig?.schema?.invariants ?? [],
      ),
    [invariantValue, displayedConfig],
  );

  // Field key → messages of the failing rules that reference it, for row-level
  // highlighting on the Form tab.
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

  // Other family members whose effective rules fail against the displayed
  // (draft-aware) state. Above the loading guard for stable hook order.
  const familyInvariantViolations = useMemo(() => {
    if (!data || !displayedConfig) return [] as LineageNode[];
    const nodes = [
      ...data.lineage,
      ...(data.composerFamilies ?? []).flatMap((f) => f.lineage),
    ];
    const seen = new Set<string>([displayedConfig.key]);
    return nodes.filter((n) => {
      if (seen.has(n.key) || !n.invariantViolations?.length) return false;
      seen.add(n.key);
      return true;
    });
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

    const resolvedObj: Record<string, unknown> = {};
    for (const f of resolved.fields) {
      if (f.value !== undefined) resolvedObj[f.key] = f.value;
    }

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
      resolvedValue: JSON.stringify(squashConstants(resolvedObj), null, 2),
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

  const handleNewDraft = async () => {
    const res = await apiCall<{ revision?: Revision }>(
      `/configs/${config.id}?forceCreateRevision=1`,
      { method: "PUT", body: JSON.stringify({}) },
    );
    if (res?.revision) await onRevisionCreated(res.revision);
  };

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

  const canUpdate = permissionsUtil.canUpdateConfig(config, config);
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
  const canDeleteNow =
    permissionsUtil.canDeleteConfig(config) &&
    !!config.archived &&
    !hasDescendants;
  // A locked config is frozen — no edit controls at all (unlock is a separate,
  // bypass-gated control). Editing is otherwise allowed both in a draft and in
  // the live view; a selected merged/discarded revision is a read-only history
  // view (selectedRevision set + not a draft), so it stays non-editable.
  const isLocked = !!config.lock;
  const canEditNow = canUpdate && !isLocked && (!selectedRevision || isDraft);
  // Inline editing works in a live context too — saving auto-creates a draft
  // (saveValue's writeQuery falls back to ?forceCreateRevision=1). Kept in lockstep
  // with canEditNow so locked/discarded contexts expose no edit controls.
  const canEditInline = canEditNow;
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

  const ownValue = (): Record<string, unknown> =>
    parsePlainJSONObject(displayedConfig.value ?? "") ?? {};

  // Write to the open draft when one is selected; otherwise (editing from the
  // live view) auto-create a draft. The forceCreateRevision path is now the
  // normal route for a live-context edit, not just a fallback.
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

  // Both cancelled on tab switch so no editor lingers off-tab.
  const cancelEdits = () => {
    setEditKey(null);
    setEditError(null);
    setSchemaEdit(null);
  };

  const startOverride = (f: ResolvedField) => {
    setSchemaEdit(null);
    setEditError(null);
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
        const t = editText.trim();
        const n = Number(t);
        if (t === "" || !Number.isFinite(n)) {
          setEditError("Value must be a number");
          return;
        }
        if (field?.type === "integer" && !Number.isInteger(n)) {
          setEditError("Value must be an integer");
          return;
        }
        parsed = n;
      } else {
        parsed = editText;
      }
    }
    // Surface backend rejections inline; the Save button has no setError of its own.
    try {
      await saveValue({ ...ownValue(), [editKey]: parsed });
      setEditKey(null);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Failed to save value");
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

  const saveField = async (
    field: SchemaField,
    value?: unknown,
    unset?: boolean,
  ) => {
    const fields = ownSchema().fields;
    const idx = fields.findIndex((f) => f.key === schemaEdit);
    const next =
      idx >= 0
        ? fields.map((f, i) => (i === idx ? field : f))
        : [...fields, field];
    let valueOverride: Record<string, unknown> | undefined;
    if (unset) {
      const v = ownValue();
      if (field.key in v) {
        delete v[field.key];
        valueOverride = v;
      }
    } else if (value !== undefined) {
      valueOverride = { ...ownValue(), [field.key]: value };
    }
    await saveSchema(next, valueOverride);
    setSchemaEdit(null);
  };

  const removeField = async (key: string) => {
    const v = ownValue();
    const hadOverride = key in v;
    delete v[key];
    setDeleteError(null);
    try {
      await saveSchema(
        ownSchema().fields.filter((f) => f.key !== key),
        hadOverride ? v : undefined,
      );
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Failed to remove field");
    }
  };

  // Removes only this config's override (reverts to inherited); the parent's definition is untouched.
  const removeOverride = async (key: string) => {
    const v = ownValue();
    delete v[key];
    setDeleteError(null);
    try {
      await saveValue(v);
    } catch (e) {
      setDeleteError(
        e instanceof Error ? e.message : "Failed to remove override",
      );
    }
  };

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
        <Box style={{ minWidth: 0, gridColumn: "span 4" }}>
          <Flex align="center" gap="3" wrap="wrap" style={{ minHeight: 32 }}>
            <Link href={`/configs/${parentKey}`} size="2">
              {name}
            </Link>
          </Flex>
        </Box>
        <Box />
      </Grid>
    );
  };

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

        <Box style={{ minWidth: 0, gridColumn: "span 4" }}>
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
              {mixinKeys.map((k) => {
                const name =
                  allConfigsForGraph.find((c) => c.key === k)?.name ?? k;
                return (
                  <DropdownMenuItem
                    key={k}
                    color="red"
                    onClick={() =>
                      saveExtends(mixinKeys.filter((x) => x !== k))
                    }
                  >
                    Remove mixin &ldquo;{name}&rdquo;
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenu>
          )}
        </Flex>
      </Grid>
    );
  };

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
          <HelperText status="error" size="sm" mt="1">
            {composeError}
          </HelperText>
        )}
      </Box>
    ) : (
      <Box mt="2" py="1">
        <Link size="2" weight="medium" onClick={() => setComposeAdding(true)}>
          <PiPlusBold style={{ marginRight: 3, verticalAlign: "middle" }} />
          Add config mixin
        </Link>
        {composeError && (
          <HelperText status="error" size="sm" mt="1">
            {composeError}
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

  return (
    <>
      <PageHead
        breadcrumb={[
          { display: "Configs", href: "/configs" },
          { display: displayedConfig.name },
        ]}
      />
      <Box className="contents container-fluid pagecontents" mt="2">
        <Flex gap="6" align="start">
          {/* Sidebar */}
          <Box
            style={{
              width: 220,
              flexShrink: 0,
              position: "sticky",
              // Stick at the column's natural top (below the 56px nav + page
              // inset) so it doesn't jump a few px on scroll before sticking.
              top: 80,
              alignSelf: "flex-start",
              maxHeight: "calc(100vh - 80px - 1rem)",
              overflowY: "auto",
            }}
          >
            <Tabs defaultValue="configs">
              <TabsList size="1">
                <TabsTrigger value="configs">
                  <Flex as="span" align="center" gap="2">
                    Configs
                    <Badge
                      size="xs"
                      color="gray"
                      radius="full"
                      label={`${nonFlavorCount}`}
                      style={{ justifyContent: "center", textAlign: "center" }}
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
                      style={{ justifyContent: "center", textAlign: "center" }}
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
                    // Only this node's draft is merged into the tree, so flag only it.
                    draftKeys={isDraft ? { [config.key]: true } : undefined}
                    extensible={effectiveExtensible}
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
                          style={{ marginRight: 3, verticalAlign: "middle" }}
                        />
                        Add override config
                      </Link>
                    ) : (
                      <PremiumTooltip commercialFeature="feature-configs">
                        <Link size="2" weight="medium" color="gray">
                          <PiPlusBold
                            style={{ marginRight: 3, verticalAlign: "middle" }}
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
                          // This config is the mixin row in each composer tree; flag it as draft.
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
                    error={(familyReferencesError ?? null) !== null}
                  />
                </Box>
              </TabsContent>
            </Tabs>
          </Box>

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
                  {config.lock && (
                    <Tooltip
                      body={`Locked at v${config.lock.version}${
                        config.lock.reason ? ` — ${config.lock.reason}` : ""
                      }. Unlock to publish.`}
                    >
                      <Badge
                        color="orange"
                        label={
                          <>
                            <PiLockSimple />{" "}
                            {`Locked · v${config.lock.version}`}
                          </>
                        }
                      />
                    </Tooltip>
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
                  {((!config.lock && canUpdate) || !!config.lock) && (
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
                                ? "You don't have permission to unlock this config."
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
                  {((!config.experimentGuard && canUpdate) ||
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
                onValueChange={(v) =>
                  setTabAndScroll(v as "overview" | "validation" | "review")
                }
              >
                <TabsList size="3">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="review">
                    Review &amp; Publish
                    {openRevisions.length > 0 && (
                      <Tooltip body={draftStatusTooltip(draftStatusCounts)}>
                        <Badge
                          label={String(openRevisions.length)}
                          color="red"
                          variant="solid"
                          radius="full"
                          ml="2"
                          style={{ minWidth: 18, height: 18 }}
                        />
                      </Tooltip>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="validation">Validation</TabsTrigger>
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
                  canEditTitle={canUpdate && !isLocked}
                  canEditDescription={canUpdate && !isLocked}
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
                  onNewDraft={
                    canUpdate && !isLocked ? handleNewDraft : undefined
                  }
                  onReviewPublish={() => setTabAndScroll("review")}
                  onEditDescription={
                    canUpdate && !isLocked
                      ? () => setEditDescriptionModal(true)
                      : undefined
                  }
                  disablePinning
                />

                <Box mb="4" pt="4" pb="5" px="6" className="appbox">
                  <ConfigEnvTabs
                    currentKey={config.key}
                    currentConfigId={config.id}
                    lineage={data.lineage}
                    configNames={data.configNames}
                    archivedByKey={data.archivedByKey}
                    canCreate={
                      hasConfigsFeature &&
                      permissionsUtil.canCreateConfig({
                        project: config.project || "",
                      })
                    }
                    mutate={mutate}
                  />
                  <Tabs
                    value={activeTab}
                    onValueChange={(v) => {
                      cancelEdits();
                      setActiveTab(
                        v === "json"
                          ? "json"
                          : v === "resolved"
                            ? "resolved"
                            : "form",
                      );
                    }}
                  >
                    <Box mb="4">
                      <Flex align="center" justify="between" width="100%">
                        <SplitButton variant="outline">
                          {(["form", "json", "resolved"] as const).map((t) => (
                            <Button
                              key={t}
                              color="violet"
                              variant={activeTab === t ? "solid" : "outline"}
                              size="sm"
                              onClick={() => {
                                cancelEdits();
                                setActiveTab(t);
                              }}
                            >
                              {t === "form"
                                ? "Form"
                                : t === "json"
                                  ? "JSON"
                                  : "Resolved"}
                            </Button>
                          ))}
                        </SplitButton>
                        <Flex align="center" gap="5" pl="4">
                          <ConfigExportMenu payloads={exportPayloads} />
                        </Flex>
                      </Flex>
                    </Box>

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
                        {isDraft && draftDescendantImpact.length > 0 && (
                          <Callout status="warning" mt="3">
                            These staged changes leave{" "}
                            {draftDescendantImpact.length === 1
                              ? "a descendant config"
                              : `${draftDescendantImpact.length} descendant configs`}{" "}
                            with overrides of removed or retyped fields:{" "}
                            {draftDescendantImpact
                              .map((n) => {
                                const parts = [
                                  ...(n.orphanedFields ?? []).map(
                                    (k) => `"${k}" (no longer declared)`,
                                  ),
                                  ...(n.incompatibleFields ?? []).map(
                                    (k) => `"${k}" (type mismatch)`,
                                  ),
                                ];
                                return `${n.name} — ${parts.join(", ")}`;
                              })
                              .join(" · ")}
                            . Publishing will warn before proceeding.
                          </Callout>
                        )}
                        {familyInvariantViolations.length > 0 && (
                          <Callout status="warning" mt="3">
                            {familyInvariantViolations.length === 1
                              ? "A config in this family violates its validation rules"
                              : `${familyInvariantViolations.length} configs in this family violate their validation rules`}{" "}
                            against the values shown here:{" "}
                            {familyInvariantViolations
                              .map(
                                (n) =>
                                  `${n.name} — ${(n.invariantViolations ?? [])
                                    .map((v) => v.message)
                                    .join("; ")}`,
                              )
                              .join(" · ")}
                          </Callout>
                        )}
                        {/* Row-level errors render inline while editing; dropdown
                            actions (remove field/override) have no row editor. */}
                        {editError && editKey === null && (
                          <Callout status="error" mt="3">
                            {editError}
                          </Callout>
                        )}
                        {deleteError && (
                          <Callout status="error" mt="3">
                            {deleteError}
                          </Callout>
                        )}
                        <Box style={{ minWidth: 800 }}>
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
                              // Pin below the fixed 56px top nav; the page scrolls the document.
                              top: 56,
                              zIndex: 2,
                              background: "var(--color-panel-solid)",
                            }}
                          >
                            {["Key", "Value", "Type", "Source", "Usage"].map(
                              (label) => (
                                <Box key={label} style={{ minWidth: 0 }}>
                                  <Flex
                                    align="center"
                                    gap="1"
                                    style={{ minHeight: 24 }}
                                  >
                                    <Text
                                      size="small"
                                      weight="medium"
                                      color="text-low"
                                      textTransform="uppercase"
                                    >
                                      {label}
                                    </Text>
                                    {label === "Usage" && (
                                      <Tooltip
                                        body="Flag rules and defaults that override this key."
                                        style={{
                                          display: "inline-flex",
                                          color: "var(--slate-9)",
                                        }}
                                      >
                                        <PiInfo />
                                      </Tooltip>
                                    )}
                                  </Flex>
                                </Box>
                              ),
                            )}
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
                                  initialUndefined={f.value === undefined}
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
                                inheritsValue={!!parentKey}
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
                                keyImplementations={implementationsByKey.get(
                                  f.key,
                                )}
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

                    {/* JSON and Resolved share ONE editor instance (only the `view` prop
                    flips), so the component stays mounted and edit buffers survive. */}
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
                  </Tabs>
                </Box>

                {(keyUsage?.implementations?.length ?? 0) > 0 && (
                  <Box mt="5" mb="4" py="4" px="6" className="appbox">
                    <ConfigUsageSection
                      implementations={keyUsage?.implementations ?? []}
                      fieldKeys={resolved.fields.map((f) => f.key)}
                    />
                  </Box>
                )}
              </>
            )}

            {tab === "validation" && (
              <>
                <ConfigInvariantsEditor
                  invariants={ownSchema().invariants ?? []}
                  fieldKeys={resolved.fields.map((f) => f.key)}
                  declaredKeys={resolved.effectiveSchema.map((f) => f.key)}
                  resolvedValue={invariantValue}
                  canEdit={canEditInline}
                  onChange={(next) =>
                    saveSchema(ownSchema().fields, undefined, undefined, next)
                  }
                />
                <ConfigCustomHooksSection
                  config={config}
                  canManage={canUpdate}
                  lineage={[
                    ...data.lineage,
                    ...(data.composerFamilies ?? []).flatMap((f) => f.lineage),
                  ]}
                />
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
        <ConfigArchiveModal
          config={displayedConfig}
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

      {editDescriptionModal && selectedRevision && (
        <EditRevisionDescriptionModal
          initialValue={selectedRevision.comment || ""}
          close={() => setEditDescriptionModal(false)}
          onSubmit={async (description) => {
            await apiCall(`/revision/${selectedRevision.id}/description`, {
              method: "PATCH",
              body: JSON.stringify({ description }),
            });
            await mutateRevisions();
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
          content="This permanently deletes the config. This cannot be undone."
          yesText="Delete"
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
}
