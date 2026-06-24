import React, { useMemo, useState } from "react";
import { useRouter } from "next/router";
import { ConstantInterface } from "shared/types/constant";
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
} from "shared/util";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { BsThreeDotsVertical } from "react-icons/bs";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import LoadingOverlay from "@/components/LoadingOverlay";
import PageHead from "@/components/Layout/PageHead";
import Owner from "@/components/Avatar/Owner";
import Markdown from "@/components/Markdown/Markdown";
// eslint-disable-next-line no-restricted-imports
import Modal from "@/components/Modal";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import Metadata from "@/ui/Metadata";
import Callout from "@/ui/Callout";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Code from "@/components/SyntaxHighlighting/Code";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import RevisionDropdown from "@/components/Revision/RevisionDropdown";
import RevisionSummaryCard from "@/components/Revision/RevisionSummaryCard";
import RevisionDetail from "@/components/Revision/RevisionDetail";
import CompareRevisionsModal from "@/components/Revision/CompareRevisionsModal";
import AuditHistoryExplorerModal from "@/components/AuditHistoryExplorer/AuditHistoryExplorerModal";
import { OVERFLOW_SECTION_LABEL } from "@/components/AuditHistoryExplorer/useAuditDiff";
import {
  REVISION_CONSTANT_DIFF_CONFIG,
  renderConstantSettings,
  renderConstantValues,
  renderConstantSchema,
  getConstantSettingsBadges,
  getConstantValuesBadges,
  getConstantSchemaBadges,
} from "@/components/Constants/ConstantDiffRenders";
import {
  ConstantConflictModal,
  useConstantMergeResult,
} from "@/components/Constants/useConstantConflictModal";
import { useConstantRevision } from "@/hooks/useConstantRevision";
import { useConstantReferences } from "@/hooks/useConstantReferences";
import ConstantModal from "@/components/Constants/ConstantModal";
import ConstantArchiveModal from "@/components/Constants/ConstantArchiveModal";
import ConstantReferencesList from "@/components/Constants/ConstantReferencesList";
import ReferencesLink from "@/components/References/ReferencesLink";
import { ConstantRevisionContext } from "@/components/Constants/useConstantDraftTarget";
import ConfigModal from "@/components/Constants/ConfigModal";

type ResolvedField = {
  key: string;
  field: SchemaField | null;
  value: unknown;
  source: string | null;
};
type LineageNode = { key: string; name: string; parentKey: string | null };
type ResolvedResponse = {
  status: number;
  config: ConstantInterface;
  // The full lineage chain (base → leaf) with each config's own value + appended
  // schema. The editor re-resolves this client-side (via `resolveConfigChain`)
  // so a selected draft's proposed value is reflected in the field table.
  chain: ConfigChainNode[];
  effectiveSchema: SchemaField[];
  fields: ResolvedField[];
  lineage: LineageNode[];
};

// Renders the lineage tree (base → children) recursively, highlighting the
// current config.
function LineageTree({
  nodes,
  parentKey,
  currentKey,
  depth = 0,
}: {
  nodes: LineageNode[];
  parentKey: string | null;
  currentKey: string;
  depth?: number;
}): React.ReactElement {
  const children = nodes.filter((n) => n.parentKey === parentKey);
  return (
    <>
      {children.map((n) => (
        <Box key={n.key}>
          <Box style={{ paddingLeft: depth * 16 }} py="1">
            <Link
              href={`/configs/${n.key}`}
              color={n.key === currentKey ? "violet" : "dark"}
              weight={n.key === currentKey ? "bold" : "regular"}
            >
              {n.name}
            </Link>
          </Box>
          <LineageTree
            nodes={nodes}
            parentKey={n.key}
            currentKey={currentKey}
            depth={depth + 1}
          />
        </Box>
      ))}
    </>
  );
}

// A blank field definition, with the same defaults the feature schema editor
// uses. `required` is always true — configs define their full field set on the
// base; children are partial value-patches, so there are no optional fields.
const blankField = (): SchemaField => ({
  key: "",
  type: "string",
  required: true,
  default: "",
  description: "",
  enum: [],
  min: 0,
  max: 256,
});

const FIELD_TYPE_OPTIONS = [
  { value: "string", label: "String" },
  { value: "integer", label: "Integer" },
  { value: "float", label: "Float" },
  { value: "boolean", label: "Boolean" },
];

// Inline editor for a single field's schema definition (add or edit). Compact by
// default — key + type on one line — with progressive disclosure: "+ description"
// adds a second line, "+ validation" reveals the allowed-values / min-max rules.
// Kept on the page itself (no modal).
function FieldDefForm({
  initial,
  existingKeys,
  onCancel,
  onSave,
}: {
  initial: SchemaField;
  // Other field keys in scope (effective schema), to block duplicates.
  existingKeys: string[];
  onCancel: () => void;
  onSave: (field: SchemaField) => void | Promise<void>;
}): React.ReactElement {
  const [field, setField] = useState<SchemaField>(initial);
  // Expand the optional sections up front when the field already uses them.
  const [showDescription, setShowDescription] = useState(!!initial.description);
  const [showValidation, setShowValidation] = useState(
    initial.enum.length > 0 || initial.min !== 0 || initial.max !== 256,
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const trimmedKey = field.key.trim();
  const duplicate =
    trimmedKey !== initial.key && existingKeys.includes(trimmedKey);

  const intOr0 = (v: string): number => {
    const n = parseInt(v);
    return Number.isNaN(n) ? 0 : n;
  };

  const save = async () => {
    if (!trimmedKey) {
      setErr("A field key is required");
      return;
    }
    if (duplicate) {
      setErr(`A field named "${trimmedKey}" already exists`);
      return;
    }
    setErr(null);
    setSaving(true);
    try {
      await onSave({ ...field, key: trimmedKey });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save field");
      setSaving(false);
    }
  };

  return (
    <Box
      mt="3"
      p="3"
      style={{
        border: "1px solid var(--slate-a5)",
        borderRadius: "var(--radius-3)",
      }}
    >
      {/* Line 1: key + type + save/cancel */}
      <Flex gap="2" align="center" wrap="wrap">
        <Box style={{ flex: "1 1 160px", minWidth: 120 }}>
          <Field
            autoFocus
            placeholder="field key"
            value={field.key}
            onChange={(e) => setField({ ...field, key: e.target.value })}
            containerStyle={{ marginBottom: 0 }}
          />
        </Box>
        <Box style={{ width: 130 }}>
          <SelectField
            value={field.type}
            onChange={(v) =>
              setField({ ...field, type: v as SchemaField["type"] })
            }
            options={FIELD_TYPE_OPTIONS}
            sort={false}
          />
        </Box>
        <Flex gap="2" ml="auto">
          <Button size="sm" onClick={save} disabled={saving}>
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </Button>
        </Flex>
      </Flex>

      {/* Line 2: description (progressive) */}
      {showDescription && (
        <Box mt="2">
          <Field
            placeholder="description (optional)"
            value={field.description}
            onChange={(e) =>
              setField({ ...field, description: e.target.value })
            }
            containerStyle={{ marginBottom: 0 }}
          />
        </Box>
      )}

      {/* Optional expansion: schema validation (not applicable to booleans) */}
      {showValidation && field.type !== "boolean" && (
        <Box mt="2">
          <MultiSelectField
            label="Allowed values"
            placeholder="(any)"
            value={field.enum}
            onChange={(e) =>
              setField({
                ...field,
                enum: e
                  .filter((v) => v !== "" && v.length <= 256)
                  .slice(0, 256),
              })
            }
            options={field.enum.map((v) => ({ value: v, label: v }))}
            creatable
            noMenu
          />
          {field.enum.length === 0 && (
            <Flex gap="2" mt="2">
              <Box style={{ flex: 1 }}>
                <Field
                  label={field.type === "string" ? "Min length" : "Min"}
                  type="number"
                  value={field.min}
                  onChange={(e) =>
                    setField({ ...field, min: intOr0(e.target.value) })
                  }
                  containerStyle={{ marginBottom: 0 }}
                />
              </Box>
              <Box style={{ flex: 1 }}>
                <Field
                  label={field.type === "string" ? "Max length" : "Max"}
                  type="number"
                  value={field.max}
                  onChange={(e) =>
                    setField({ ...field, max: intOr0(e.target.value) })
                  }
                  containerStyle={{ marginBottom: 0 }}
                />
              </Box>
            </Flex>
          )}
        </Box>
      )}

      {/* Progressive-disclosure toggles */}
      <Flex gap="3" mt="2" align="center">
        {!showDescription && (
          <Link onClick={() => setShowDescription(true)}>+ description</Link>
        )}
        {!showValidation && field.type !== "boolean" && (
          <Link onClick={() => setShowValidation(true)}>+ validation</Link>
        )}
      </Flex>

      {err && (
        <Callout status="error" mt="2" size="sm">
          {err}
        </Callout>
      )}
    </Box>
  );
}

export default function ConfigDetailPage(): React.ReactElement {
  const router = useRouter();
  const { cfgid } = router.query;
  const configKey = typeof cfgid === "string" ? cfgid : "";

  const { apiCall } = useAuth();
  const { projects, mutateDefinitions } = useDefinitions();
  const { organization, userId, hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();

  const [editInfoOpen, setEditInfoOpen] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [showChangesModal, setShowChangesModal] = useState(false);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [showReferencesModal, setShowReferencesModal] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showCreateChild, setShowCreateChild] = useState(false);

  // Field currently being overridden (inline value edit), and the draft text.
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  // Inline schema authoring: "add" shows a blank field form; a key string edits
  // that field's definition.
  const [schemaEdit, setSchemaEdit] = useState<"add" | string | null>(null);

  // The detail page is addressed by the config's `key`; the resolved endpoint
  // returns the underlying constant (`config`) plus its lineage chain + tree.
  const { data, error, mutate } = useApi<ResolvedResponse>(
    `/constants/${configKey}/resolved`,
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
  } = useConstantRevision(config?.id, mutate, config);

  const { references } = useConstantReferences(config?.id);
  const totalReferences =
    (references?.features.length ?? 0) + (references?.constants.length ?? 0);

  const settings = organization.settings || {};
  const hasApprovalsFeature = hasCommercialFeature("require-approvals");

  // Configs inherit the feature `requireReviews` settings (same adapter as
  // constants). Resolve the rule matching this config's project for the coarse
  // "is approval configured" gate; the precise per-revision decision uses
  // `constantRequiresReview` below (mirroring the back-end adapter).
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
        project: (selectedRevision.target.snapshot as ConstantInterface)
          .project,
      },
      getConstantRevisionChange(
        selectedRevision.target.snapshot as ConstantInterface,
        selectedRevision.target.proposedChanges,
      ),
      settings,
    );

  // Show the selected revision's proposed state when one is selected.
  const displayedConfig = useMemo(() => {
    if (!selectedRevision) return config;
    return applyTopLevelPatchOps(
      selectedRevision.target.snapshot as ConstantInterface,
      selectedRevision.target.proposedChanges,
    ) as ConstantInterface;
  }, [selectedRevision, config]);

  // Re-resolve the lineage chain with the displayed (possibly draft) value of
  // this node substituted in, so the field table reflects the revision in view.
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

  const mergeResult = useConstantMergeResult(config, selectedRevision, isDraft);

  const parentKey = useMemo(() => {
    const self = data?.lineage.find((n) => n.key === config?.key);
    return self?.parentKey ?? null;
  }, [data?.lineage, config?.key]);

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

  // Explicitly start an empty draft to work in (forceCreateRevision creates one
  // regardless of approval settings).
  const handleNewDraft = async () => {
    const res = await apiCall<{ revision?: Revision }>(
      `/constants/${config.id}?forceCreateRevision=1`,
      { method: "PUT", body: JSON.stringify({}) },
    );
    if (res?.revision) await onRevisionCreated(res.revision);
  };

  const canUpdate = permissionsUtil.canUpdateConstant(config, config);
  const canDeleteNow =
    permissionsUtil.canDeleteConstant(config) && !!config.archived;
  // Editing is only meaningful on the live state or a draft.
  const canEditNow = canUpdate && (!selectedRevision || isDraft);
  // Inline field/value editing is draft-only: changes must land in an active
  // draft (not silently auto-publish from the live view). On a non-draft view
  // the form shows an "Edit" button (handleEdit) that drops into a draft.
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

  // Own-value object of the currently-displayed config (keeps `$extends`).
  const ownValue = (): Record<string, unknown> =>
    parsePlainJSONObject(displayedConfig.value ?? "") ?? {};

  // Inline edits are gated to an active draft (see canEditInline), so they
  // always target the selected draft rather than silently publishing. The
  // forceCreateRevision fallback is defensive — it should not be reached.
  const writeQuery = (): string =>
    selectedRevision && isDraft
      ? `?revisionId=${selectedRevision.id}`
      : `?forceCreateRevision=1`;

  const saveValue = async (next: Record<string, unknown>) => {
    const res = await apiCall<{ revision?: Revision }>(
      `/constants/${config.id}${writeQuery()}`,
      { method: "PUT", body: JSON.stringify({ value: JSON.stringify(next) }) },
    );
    await mutate();
    if (res?.revision) await onRevisionCreated(res.revision);
  };

  const startOverride = (f: ResolvedField) => {
    setEditError(null);
    setEditText(JSON.stringify(f.value ?? null, null, 2));
    setEditKey(f.key);
  };

  const resetField = async (key: string) => {
    const v = ownValue();
    delete v[key];
    await saveValue(v);
  };

  const submitOverride = async () => {
    if (!editKey) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(editText);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Invalid JSON");
      return;
    }
    await saveValue({ ...ownValue(), [editKey]: parsed });
    setEditKey(null);
  };

  // The fields this config *appends* (its own schema). Inherited fields are
  // owned by ancestors and can't be edited or removed here.
  const ownSchema = (): SimpleSchema =>
    displayedConfig.schema ?? { type: "object", fields: [] };
  const ownSchemaKeys = ownSchema().fields.map((sf) => sf.key);

  // Persist a new appended-schema (optionally clearing a value override in the
  // same write) through the revision system.
  const saveSchema = async (
    fields: SchemaField[],
    valueOverride?: Record<string, unknown>,
  ) => {
    const schema: SimpleSchema = { type: ownSchema().type, fields };
    const res = await apiCall<{ revision?: Revision }>(
      `/constants/${config.id}${writeQuery()}`,
      {
        method: "PUT",
        body: JSON.stringify({
          schema,
          ...(valueOverride ? { value: JSON.stringify(valueOverride) } : {}),
        }),
      },
    );
    await mutate();
    if (res?.revision) await onRevisionCreated(res.revision);
  };

  const saveField = async (field: SchemaField) => {
    const fields = ownSchema().fields;
    const idx = fields.findIndex((f) => f.key === schemaEdit);
    const next =
      idx >= 0
        ? fields.map((f, i) => (i === idx ? field : f))
        : [...fields, field];
    await saveSchema(next);
    setSchemaEdit(null);
  };

  const deleteFieldDef = async (key: string) => {
    const v = ownValue();
    const hadOverride = key in v;
    delete v[key];
    await saveSchema(
      ownSchema().fields.filter((f) => f.key !== key),
      hadOverride ? v : undefined,
    );
  };

  return (
    <>
      <PageHead
        breadcrumb={[
          { display: "Configs", href: "/configs" },
          { display: displayedConfig.name },
        ]}
      />
      <Box className="contents container-fluid pagecontents" mt="2">
        <Flex gap="5" align="start">
          {/* Lineage sidebar — always shows the full base → child family. */}
          <Box style={{ width: 170, flexShrink: 0 }}>
            <Text size="small" weight="semibold" color="text-low">
              CONFIGS
            </Text>
            <Box mt="2">
              <LineageTree
                nodes={data.lineage}
                parentKey={null}
                currentKey={config.key}
              />
            </Box>
            {canUpdate && (
              <Box mt="3">
                <Link onClick={() => setShowCreateChild(true)}>
                  + Add override config
                </Link>
              </Box>
            )}
          </Box>

          {/* Main */}
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Flex align="start" justify="between" gap="2" mb="2">
              <Flex align="center" gap="3" style={{ marginTop: "-4px" }}>
                <Heading size="x-large" as="h1" mb="0">
                  {displayedConfig.name}
                </Heading>
                <Badge
                  label={parentKey ? `extends ${parentKey}` : "base config"}
                  color="gray"
                  variant="soft"
                />
                {displayedConfig.archived && (
                  <Badge label="Archived" color="gray" />
                )}
              </Flex>
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

            <Flex align="center" gap="4" mb="4" wrap="wrap" justify="between">
              <Flex gap="4" align="center" wrap="wrap">
                <Metadata label="Key" value={config.key} />
                <Metadata
                  label="Project"
                  value={projectName || "All projects"}
                />
                <Box>
                  <Text weight="medium">Owner: </Text>
                  <Owner ownerId={displayedConfig.owner} gap="1" />
                </Box>
              </Flex>
              <ReferencesLink
                total={totalReferences}
                onShow={() => setShowReferencesModal(true)}
                emptyTooltip="No features or configs currently reference this config."
              />
            </Flex>

            {displayedConfig.description && (
              <Box mb="3">
                <Markdown>{displayedConfig.description}</Markdown>
              </Box>
            )}

            <RevisionSummaryCard
              allRevisions={allRevisions}
              selectedRevision={selectedRevision}
              entityNoun="config"
              hasRevisions={allRevisions.length > 0}
              metadataReviewRequired={metadataReviewRequired}
              requiresApproval={selectedRevisionRequiresApproval}
              mergeResult={mergeResult}
              currentUserId={userId}
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
              onReopen={async (revisionId) => {
                await handleReopen(revisionId);
              }}
              onDiscard={async (revisionId) => {
                await handleDiscard(revisionId);
              }}
              onNewDraft={canUpdate ? handleNewDraft : undefined}
              onCompare={() => setCompareOpen(true)}
              onFixConflicts={() => setConflictOpen(true)}
              onReviewPublish={() => setShowChangesModal(true)}
              promptDraftWhenLive
            />

            <Text as="p" color="text-mid" mb="3">
              {resolved.effectiveSchema.length} fields ·{" "}
              {resolved.fields.filter((f) => f.source === config.key).length}{" "}
              overridden here · resolved at request time
            </Text>

            <Frame>
              <Tabs defaultValue="form">
                <TabsList>
                  <TabsTrigger value="form">Form</TabsTrigger>
                  <TabsTrigger value="schema">Schema</TabsTrigger>
                  <TabsTrigger value="json">JSON</TabsTrigger>
                </TabsList>

                {/* Form — per-field resolved values (override / reset). */}
                <TabsContent value="form">
                  {resolved.fields.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableColumnHeader>Key</TableColumnHeader>
                          <TableColumnHeader>Type</TableColumnHeader>
                          <TableColumnHeader>Value</TableColumnHeader>
                          <TableColumnHeader>Source</TableColumnHeader>
                          <TableColumnHeader>{""}</TableColumnHeader>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {resolved.fields.map((f) => {
                          const here = f.source === config.key;
                          return (
                            <TableRow key={f.key}>
                              <TableCell>{f.key}</TableCell>
                              <TableCell>
                                <Text color="text-mid">
                                  {f.field?.type ?? "—"}
                                </Text>
                              </TableCell>
                              <TableCell>
                                {editKey === f.key ? (
                                  <Box style={{ maxWidth: 360 }}>
                                    <Field
                                      textarea
                                      minRows={2}
                                      value={editText}
                                      onChange={(e) =>
                                        setEditText(e.target.value)
                                      }
                                    />
                                    {editError && (
                                      <Text size="small" color="text-mid">
                                        {editError}
                                      </Text>
                                    )}
                                  </Box>
                                ) : f.value !== undefined ? (
                                  <code>{JSON.stringify(f.value)}</code>
                                ) : f.field?.default ? (
                                  <Text color="text-low">
                                    <code>{f.field.default}</code> (default)
                                  </Text>
                                ) : (
                                  <Text color="text-low">—</Text>
                                )}
                              </TableCell>
                              <TableCell>
                                {here ? (
                                  <Badge
                                    label="defined here"
                                    color="violet"
                                    variant="soft"
                                  />
                                ) : (
                                  <Badge
                                    label={f.source ?? "default"}
                                    color="gray"
                                    variant="soft"
                                  />
                                )}
                              </TableCell>
                              <TableCell>
                                <Flex gap="2" justify="end">
                                  {editKey === f.key ? (
                                    <>
                                      <Button
                                        size="xs"
                                        onClick={submitOverride}
                                      >
                                        Save
                                      </Button>
                                      <Button
                                        size="xs"
                                        variant="ghost"
                                        onClick={() => setEditKey(null)}
                                      >
                                        Cancel
                                      </Button>
                                    </>
                                  ) : (
                                    canEditInline && (
                                      <>
                                        <Link onClick={() => startOverride(f)}>
                                          override
                                        </Link>
                                        {here && (
                                          <Link
                                            onClick={() => resetField(f.key)}
                                          >
                                            reset
                                          </Link>
                                        )}
                                      </>
                                    )
                                  )}
                                </Flex>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  ) : (
                    <Text color="text-low">
                      No fields yet — define them in the Schema tab.
                    </Text>
                  )}
                </TabsContent>

                {/* Schema — field definitions (add / edit / delete). */}
                <TabsContent value="schema">
                  {resolved.fields.length > 0 && (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableColumnHeader>Key</TableColumnHeader>
                          <TableColumnHeader>Type</TableColumnHeader>
                          <TableColumnHeader>Description</TableColumnHeader>
                          <TableColumnHeader>Defined in</TableColumnHeader>
                          <TableColumnHeader>{""}</TableColumnHeader>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {resolved.fields.map((f) => {
                          const ownField = ownSchemaKeys.includes(f.key);
                          return (
                            <TableRow key={f.key}>
                              <TableCell>{f.key}</TableCell>
                              <TableCell>
                                <Text color="text-mid">
                                  {f.field?.type ?? "—"}
                                </Text>
                              </TableCell>
                              <TableCell>
                                <Text
                                  color={
                                    f.field?.description
                                      ? "text-mid"
                                      : "text-low"
                                  }
                                >
                                  {f.field?.description || "—"}
                                </Text>
                              </TableCell>
                              <TableCell>
                                {ownField ? (
                                  <Badge
                                    label="this config"
                                    color="violet"
                                    variant="soft"
                                  />
                                ) : (
                                  <Badge
                                    label="inherited"
                                    color="gray"
                                    variant="soft"
                                  />
                                )}
                              </TableCell>
                              <TableCell>
                                <Flex gap="2" justify="end">
                                  {canEditInline &&
                                    schemaEdit === null &&
                                    ownField && (
                                      <>
                                        <Link
                                          onClick={() => setSchemaEdit(f.key)}
                                        >
                                          edit
                                        </Link>
                                        <Link
                                          color="red"
                                          onClick={() => deleteFieldDef(f.key)}
                                        >
                                          delete
                                        </Link>
                                      </>
                                    )}
                                </Flex>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}

                  {schemaEdit !== null && schemaEdit !== "add" && (
                    <FieldDefForm
                      key={schemaEdit}
                      initial={
                        ownSchema().fields.find((f) => f.key === schemaEdit) ??
                        blankField()
                      }
                      existingKeys={resolved.fields.map((f) => f.key)}
                      onCancel={() => setSchemaEdit(null)}
                      onSave={saveField}
                    />
                  )}

                  {schemaEdit === "add" ? (
                    <FieldDefForm
                      key="add"
                      initial={blankField()}
                      existingKeys={resolved.fields.map((f) => f.key)}
                      onCancel={() => setSchemaEdit(null)}
                      onSave={saveField}
                    />
                  ) : (
                    schemaEdit === null && (
                      <Box mt="3">
                        {resolved.fields.length === 0 && (
                          <Text as="p" color="text-low" mb="2">
                            No fields yet.
                          </Text>
                        )}
                        {canEditInline && (
                          <Button
                            variant="soft"
                            onClick={() => setSchemaEdit("add")}
                          >
                            + Add field
                          </Button>
                        )}
                      </Box>
                    )
                  )}
                </TabsContent>

                {/* JSON — raw value (read-only; paste-to-import is future work). */}
                <TabsContent value="json">
                  <Code
                    language="json"
                    code={displayedConfig.value || "{}"}
                    expandable={false}
                  />
                </TabsContent>
              </Tabs>
            </Frame>
          </Box>
        </Flex>
      </Box>

      {showChangesModal && selectedRevision && (
        <Modal
          header={selectedRevision.title || "Revision"}
          trackingEventModalType="config-revision-changes"
          close={() => setShowChangesModal(false)}
          open={showChangesModal}
          dismissible
          size="max"
          hideCta={true}
          closeCta="Close"
          useRadixButton={true}
        >
          <RevisionDetail<ConstantInterface>
            diffConfig={REVISION_CONSTANT_DIFF_CONFIG}
            revision={selectedRevision}
            currentState={config}
            mutate={async () => {
              await Promise.all([mutateRevisions(), mutate()]);
            }}
            setCurrentRevision={(r) => selectRevision(r)}
            onPublish={async (revisionId) => {
              await handlePublish(revisionId);
            }}
            onReopen={async (revisionId) => {
              await handleReopen(revisionId);
            }}
            allRevisions={allRevisions}
            requiresApproval={selectedRevisionRequiresApproval}
            closeModal={() => setShowChangesModal(false)}
            canUpdateEntity={(s) => permissionsUtil.canUpdateConstant(s, {})}
          />
        </Modal>
      )}

      {showReferencesModal && references && (
        <Modal
          header={`'${displayedConfig.name}' References`}
          trackingEventModalType="show-config-references"
          close={() => setShowReferencesModal(false)}
          open={showReferencesModal}
          closeCta="Close"
          useRadixButton={true}
        >
          <Text as="p" mb="3">
            This config is referenced by the following features and configs via{" "}
            <code>@const:{config.key}</code>.
          </Text>
          <ConstantReferencesList
            features={references.features}
            constants={references.constants}
          />
        </Modal>
      )}

      {editInfoOpen && (
        <ConstantModal
          existing={displayedConfig}
          revisionCtx={revisionCtx}
          onSaved={async (revision) => {
            await onRevisionCreated(revision);
          }}
          close={() => setEditInfoOpen(false)}
        />
      )}

      {showArchiveModal && (
        <ConstantArchiveModal
          constant={displayedConfig}
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
          diffConfig={REVISION_CONSTANT_DIFF_CONFIG}
          allRevisions={allRevisions}
          currentRevisionId={selectedRevisionId}
          onClose={() => setCompareOpen(false)}
          mutate={async () => {
            await Promise.all([mutateRevisions(), mutate()]);
          }}
          requiresApproval={approvalRequired}
        />
      )}

      {showAuditModal && (
        <AuditHistoryExplorerModal<ConstantInterface>
          entityId={config.id}
          entityName="Config"
          config={{
            entityType: "constant",
            includedEvents: ["constant.created", "constant.updated"],
            alwaysVisibleEvents: ["constant.created"],
            labelOnlyEvents: [
              {
                event: "constant.deleted",
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
                keys: ["value", "environmentValues"],
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
            updateEventNames: ["constant.updated"],
            defaultGroupBy: "minute",
            hideFilters: true,
            hiddenLabelSections: [OVERFLOW_SECTION_LABEL],
          }}
          onClose={() => setShowAuditModal(false)}
        />
      )}

      {conflictOpen && selectedRevision && (
        <ConstantConflictModal
          constant={config}
          selectedRevision={selectedRevision}
          close={() => setConflictOpen(false)}
          mutate={async () => {
            await Promise.all([mutateRevisions(), mutate()]);
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete "${config.name}"?`}
          content="This permanently deletes the config. This cannot be undone."
          yesText="Delete"
          onConfirm={async () => {
            await apiCall(`/constants/${config.id}`, { method: "DELETE" });
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
