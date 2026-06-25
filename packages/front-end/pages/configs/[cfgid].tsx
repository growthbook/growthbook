import React, { useMemo, useState } from "react";
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
} from "shared/util";
import {
  buildConstantValueMap,
  resolveConstantRefs,
} from "shared/sdk-versioning";
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
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import Metadata from "@/ui/Metadata";
import Callout from "@/ui/Callout";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Code from "@/components/SyntaxHighlighting/Code";
import SplitButton from "@/ui/SplitButton";
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
  REVISION_CONFIG_DIFF_CONFIG,
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
import LineageTree from "@/components/Configs/LineageTree";
import FieldDefForm from "@/components/Configs/FieldDefForm";
import ConfigFieldRow from "@/components/Configs/ConfigFieldRow";
import {
  FIELD_COLS,
  ResolvedField,
  LineageNode,
  blankField,
  isJsonField,
  typeDefault,
} from "@/components/Configs/fieldSchema";

type ResolvedResponse = {
  status: number;
  config: ConfigInterface;
  // The full lineage chain (base → leaf) with each config's own value + appended
  // schema. The editor re-resolves this client-side (via `resolveConfigChain`)
  // so a selected draft's proposed value is reflected in the field table.
  chain: ConfigChainNode[];
  effectiveSchema: SchemaField[];
  fields: ResolvedField[];
  lineage: LineageNode[];
  // Project-scoped constant value-map inputs, so the field table can squash
  // `@const:` references client-side (default values; same scrubbing as the
  // payload). The editor and JSON view keep references raw.
  constants: Pick<
    ConstantInterface,
    "key" | "type" | "value" | "project" | "archived"
  >[];
};

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
  const [activeTab, setActiveTab] = useState<"form" | "json">("form");
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  // The value's "state" is separate from its text so an explicit null and a
  // concrete value are distinct choices — never conflated. (Not overriding a key
  // at all is a separate axis, handled by the inherit / Reset action.)
  const [editKind, setEditKind] = useState<"value" | "null">("value");

  // Inline schema authoring: "add" shows a blank field form; a key string edits
  // that field's definition.
  const [schemaEdit, setSchemaEdit] = useState<"add" | string | null>(null);

  // The detail page is addressed by the config's `key`; the resolved endpoint
  // returns the underlying constant (`config`) plus its lineage chain + tree.
  const { data, error, mutate } = useApi<ResolvedResponse>(
    `/configs/${configKey}/resolved`,
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

  const { references } = useConstantReferences(config?.id, "configs");
  const totalReferences =
    (references?.features.length ?? 0) + (references?.constants.length ?? 0);

  // Constant-picker scope for value editing: cycle-creating keys + this config
  // itself are scrubbed so a value can't reference back into a cycle.
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

  // Squash `@const:` references in field values for the table display, recursively
  // resolving to default values (cross-project refs scrubbed like the payload).
  // The editor and JSON view keep references raw.
  const squashConstants = useMemo(() => {
    const map = buildConstantValueMap(data?.constants ?? [], "");
    const project = config?.project || "";
    return (value: unknown): unknown =>
      resolveConstantRefs(value, map, new Set(), undefined, project);
  }, [data?.constants, config?.project]);

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

  // Always-expanded JSON readout: every key/value on its own line (2-space
  // indent), never compacted onto one line — even for small objects.
  const jsonReadout = useMemo(() => {
    const raw = displayedConfig?.value || "{}";
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  }, [displayedConfig?.value]);

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

  const mergeResult = useConstantMergeResult(
    config,
    selectedRevision,
    isDraft,
    "config",
  );

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
      `/configs/${config.id}${writeQuery()}`,
      { method: "PUT", body: JSON.stringify({ value: JSON.stringify(next) }) },
    );
    await mutate();
    if (res?.revision) await onRevisionCreated(res.revision);
  };

  // Only one thing is edited at a time: a value override (editKey) and a schema
  // add/edit (schemaEdit) are mutually exclusive, and both are cancelled on tab
  // switch so an open editor can't linger invisibly on another tab.
  const cancelEdits = () => {
    setEditKey(null);
    setEditError(null);
    setSchemaEdit(null);
  };

  const startOverride = (f: ResolvedField) => {
    setSchemaEdit(null);
    setEditError(null);
    // Seed from the resolved value: explicit null, or a concrete value. A field
    // with nothing set seeds from its type default (never "unset").
    if (f.value === null) {
      setEditKind("null");
      setEditText("");
    } else {
      setEditKind("value");
      const v = f.value !== undefined ? f.value : typeDefault(f.field);
      // JSON fields edit as raw JSON; simple types edit as their literal text.
      setEditText(
        isJsonField(f.field) ? JSON.stringify(v, null, 2) : String(v),
      );
    }
    setEditKey(f.key);
  };

  const submitOverride = async () => {
    if (!editKey) return;
    if (editKind === "null") {
      await saveValue({ ...ownValue(), [editKey]: null });
      setEditKey(null);
      return;
    }
    const field = resolved.fields.find((f) => f.key === editKey)?.field ?? null;
    let parsed: unknown;
    if (isJsonField(field)) {
      try {
        parsed = JSON.parse(editText);
      } catch (e) {
        setEditError(e instanceof Error ? e.message : "Invalid JSON");
        return;
      }
    } else if (field && field.type === "boolean") {
      parsed = editText === "true";
    } else if (field && (field.type === "integer" || field.type === "float")) {
      const n =
        field.type === "integer"
          ? parseInt(editText, 10)
          : parseFloat(editText);
      if (Number.isNaN(n)) {
        setEditError("Value must be a number");
        return;
      }
      parsed = n;
    } else {
      // string — any text is valid, including an empty string.
      parsed = editText;
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
      `/configs/${config.id}${writeQuery()}`,
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

  const saveField = async (field: SchemaField, value?: unknown) => {
    const fields = ownSchema().fields;
    const idx = fields.findIndex((f) => f.key === schemaEdit);
    const next =
      idx >= 0
        ? fields.map((f, i) => (i === idx ? field : f))
        : [...fields, field];
    // When a value was supplied (insert flow), set it on this config in the
    // same write as the schema change.
    const valueOverride =
      value !== undefined ? { ...ownValue(), [field.key]: value } : undefined;
    await saveSchema(next, valueOverride);
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

  // The add-field affordance: compact create row when adding (key + value +
  // type), a button otherwise.
  const renderAddField = () =>
    schemaEdit === "add" ? (
      <FieldDefForm
        key="add"
        withValue
        isNew
        initial={blankField()}
        existingKeys={resolved.fields.map((f) => f.key)}
        onCancel={() => setSchemaEdit(null)}
        onSave={saveField}
      />
    ) : (
      canEditInline &&
      schemaEdit === null && (
        <Box mt="2">
          <Button
            variant="soft"
            onClick={() => {
              setEditKey(null);
              setSchemaEdit("add");
            }}
          >
            + Add field
          </Button>
        </Box>
      )
    );

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

            <Box mb="4" py="5" px="6" className="appbox">
              <SplitButton variant="outline" mb="4">
                {(["form", "json"] as const).map((tab) => (
                  <Button
                    key={tab}
                    size="sm"
                    variant={activeTab === tab ? "solid" : "outline"}
                    onClick={() => {
                      cancelEdits();
                      setActiveTab(tab);
                    }}
                  >
                    {tab === "json" ? "JSON" : "Form"}
                  </Button>
                ))}
              </SplitButton>

              {/* Form — per-field resolved values (override / reset). */}
              {activeTab === "form" && (
                <>
                  {/* Column header — always shown, aligns with the insert row
                      (FIELD_COLS). Source carries the inheritance/lineage
                      provenance. */}
                  <Flex
                    gap="2"
                    align="center"
                    mt="3"
                    pb="1"
                    px="3"
                    style={{ borderBottom: "1px solid var(--slate-a4)" }}
                  >
                    {[
                      ["Key", FIELD_COLS.key],
                      ["Value", FIELD_COLS.value],
                      ["Type", FIELD_COLS.type],
                      ["Source", undefined],
                    ].map(([label, w]) => (
                      <Box
                        key={label}
                        style={
                          w === undefined
                            ? { flex: 1, minWidth: 80 }
                            : { width: w as number, flexShrink: 0 }
                        }
                      >
                        <Text
                          size="small"
                          weight="medium"
                          color="text-low"
                          textTransform="uppercase"
                        >
                          {label}
                        </Text>
                      </Box>
                    ))}
                  </Flex>

                  {resolved.fields.map((f) => {
                    // Editing this field's definition replaces the row with the
                    // decoupled schema-only editor.
                    if (schemaEdit === f.key) {
                      return (
                        <FieldDefForm
                          key={f.key}
                          schemaOnly
                          initial={
                            ownSchema().fields.find((sf) => sf.key === f.key) ??
                            blankField()
                          }
                          existingKeys={resolved.fields.map((rf) => rf.key)}
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
                        onDeleteDefinition={() => deleteFieldDef(f.key)}
                      />
                    );
                  })}

                  {resolved.fields.length === 0 && schemaEdit !== "add" && (
                    <Text as="p" size="small" color="text-low" mt="3" mb="1">
                      No fields yet.
                    </Text>
                  )}
                  {renderAddField()}
                </>
              )}

              {/* JSON — raw value (read-only; paste-to-import is future work). */}
              {activeTab === "json" && (
                <Box mt="3">
                  <Code language="json" code={jsonReadout} expandable={false} />
                </Box>
              )}
            </Box>
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
          <RevisionDetail<ConfigInterface>
            diffConfig={REVISION_CONFIG_DIFF_CONFIG}
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
            canUpdateEntity={(s) => permissionsUtil.canUpdateConfig(s, {})}
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
          entity="configs"
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
          entity="configs"
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
          mutate={async () => {
            await Promise.all([mutateRevisions(), mutate()]);
          }}
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
            updateEventNames: ["config.updated"],
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
