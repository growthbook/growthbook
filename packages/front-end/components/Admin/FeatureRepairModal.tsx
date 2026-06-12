import { FC, useCallback, useEffect, useMemo, useState } from "react";
import { FaAngleRight, FaSearch } from "react-icons/fa";
import { date } from "shared/dates";
import stringify from "json-stringify-pretty-compact";
import Collapsible from "react-collapsible";
import Pagination from "@/components/Pagination";
import Code from "@/components/SyntaxHighlighting/Code";
import { useAuth } from "@/services/auth";
// Legacy Modal is the only one supporting size="max", needed for the wide
// scan table and side-by-side rule diffs.
// eslint-disable-next-line no-restricted-imports
import Modal from "@/components/Modal";
import LoadingSpinner from "@/components/LoadingSpinner";
import ConfirmButton from "@/components/Modal/ConfirmButton";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";

interface RepairFinding {
  featureId: string;
  version: number;
  project: string;
  archived: boolean;
  dateUpdated: string | null;
  featureDocShape: "v0" | "v1" | "v2" | "mixed";
  liveRevisionDocShape: "v1" | "v2" | null;
  legacyEnvRulesOnDisk: string[];
  nonV2TopLevelRules: boolean;
  missingLiveRevision: boolean;
  legacyLiveRevisionDoc: boolean;
  drift: {
    defaultValue: boolean;
    envs: string[];
    direction: "feature_from_revision" | "revision_from_feature";
  } | null;
  phantomPublishedVersions: number[];
  corruptDrafts: {
    version: number;
    wipedEnvs: string[];
    envPlans?: {
      env: string;
      source: "replay" | "live";
      orderUncertain: boolean;
      reason: string | null;
      ruleCount: number;
    }[];
  }[];
  emptiedDraftsWithHistory: { version: number; wipedEnvs: string[] }[];
}

interface RepairScanResult {
  featuresScanned: number;
  findings: RepairFinding[];
  summary: {
    featuresFlagged: number;
    legacyEnvRulesOnDisk: number;
    nonV2TopLevelRules: number;
    missingLiveRevision: number;
    legacyLiveRevisionDoc: number;
    drift: number;
    phantomPublishedRevisions: number;
    corruptDrafts: number;
    emptiedDraftsWithHistory: number;
  };
}

type RepairMode = "drift" | "corruptDrafts";

interface RepairProposal {
  finding: RepairFinding;
  feature: {
    rules: { before: unknown; after: unknown } | null;
    defaultValue: { before: string; after: string } | null;
  };
  notes: string[];
}

interface RepairApplyResult {
  featureId: string;
  status: "repaired" | "skipped" | "error";
  actions: string[];
  error?: string;
}

// Real inconsistencies: the feature/revision pair actively disagrees or
// carries never-applied state. These need attention. `version` deep-links
// the badge to that revision on the feature page (`?v={n}`).
function findingIssues(
  f: RepairFinding,
): { label: string; version?: number }[] {
  const issues: { label: string; version?: number }[] = [];
  if (f.missingLiveRevision) {
    issues.push({ label: "no revision doc at live version" });
  }
  if (f.drift) {
    issues.push({
      label: `feature ≠ live revision: ${[
        ...(f.drift.defaultValue ? ["defaultValue"] : []),
        ...f.drift.envs,
      ].join(", ")}`,
      version: f.version,
    });
  }
  for (const version of f.phantomPublishedVersions) {
    issues.push({
      label: `v${version} marked published, never applied`,
      version,
    });
  }
  for (const draft of f.corruptDrafts) {
    const allReplayable =
      (draft.envPlans?.length ?? 0) > 0 &&
      (draft.envPlans ?? []).every((p) => p.source === "replay");
    issues.push({
      label: `draft v${draft.version} would empty: ${draft.wipedEnvs.join(
        ", ",
      )} — ${allReplayable ? "edits replayable from logs" : "restore from live"}`,
      version: draft.version,
    });
  }
  return issues;
}

// Benign legacy storage shapes: serving is correct (the JIT read path
// migrates them), the repair just persists the canonical form.
function findingNoteLabels(f: RepairFinding): string[] {
  const labels: string[] = [];
  if (f.legacyEnvRulesOnDisk.length > 0) {
    labels.push(`legacy env rules on disk (${f.legacyEnvRulesOnDisk.length})`);
  }
  if (f.nonV2TopLevelRules) labels.push("non-canonical top-level rules");
  if (f.legacyLiveRevisionDoc) labels.push("legacy live revision doc");
  for (const draft of f.emptiedDraftsWithHistory) {
    labels.push(
      `draft v${draft.version} empties ${draft.wipedEnvs.join(
        ", ",
      )} (has delete history, likely intentional)`,
    );
  }
  return labels;
}

const DRY_RUN_PER_PAGE = 10;

const FeatureRepairModal: FC<{
  organizationId: string;
  organizationName: string;
  close: () => void;
}> = ({ organizationId, organizationName, close }) => {
  const { apiCall } = useAuth();
  const [scanResult, setScanResult] = useState<RepairScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [proposals, setProposals] = useState<RepairProposal[] | null>(null);
  const [dryRunTotal, setDryRunTotal] = useState(0);
  const [dryRunPage, setDryRunPage] = useState(1);
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [applyResults, setApplyResults] = useState<RepairApplyResult[] | null>(
    null,
  );
  const [repairError, setRepairError] = useState("");
  // Feature ids selected for dry run / apply. Only rows with actual
  // inconsistencies are selectable; benign legacy-shape rows are report-only.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const runScan = useCallback(async () => {
    setScanning(true);
    setRepairError("");
    try {
      const res = await apiCall<RepairScanResult>(
        `/admin/organization/${encodeURIComponent(
          organizationId,
        )}/feature-repair/scan`,
      );
      setScanResult(res);
      setProposals(null);
      // Default-select every feature with a real inconsistency
      setSelectedIds(
        new Set(
          res.findings
            .filter((f) => findingIssues(f).length > 0)
            .map((f) => f.featureId),
        ),
      );
    } catch (e) {
      setRepairError(e.message);
    }
    setScanning(false);
  }, [apiCall, organizationId]);

  const selectableIds = useMemo(
    () =>
      (scanResult?.findings ?? [])
        .filter((f) => findingIssues(f).length > 0)
        .map((f) => f.featureId),
    [scanResult],
  );

  // Quick-select sets for the two repair actions
  const driftFixableIds = useMemo(
    () =>
      (scanResult?.findings ?? [])
        .filter((f) => f.drift?.direction === "feature_from_revision")
        .map((f) => f.featureId),
    [scanResult],
  );
  const corruptDraftIds = useMemo(
    () =>
      (scanResult?.findings ?? [])
        .filter((f) => f.corruptDrafts.length > 0)
        .map((f) => f.featureId),
    [scanResult],
  );

  useEffect(() => {
    runScan();
  }, [runScan]);

  const runDryRun = async (page: number) => {
    setDryRunLoading(true);
    setRepairError("");
    try {
      const res = await apiCall<{
        total: number;
        proposals: RepairProposal[];
      }>(
        `/admin/organization/${encodeURIComponent(
          organizationId,
        )}/feature-repair/dry-run`,
        {
          method: "POST",
          body: JSON.stringify({
            featureIds: [...selectedIds],
            page,
            limit: DRY_RUN_PER_PAGE,
          }),
        },
      );
      setProposals(res.proposals);
      setDryRunTotal(res.total);
      setDryRunPage(page);
    } catch (e) {
      setRepairError(e.message);
    }
    setDryRunLoading(false);
  };

  const runApply = async (mode: RepairMode) => {
    setRepairError("");
    try {
      const res = await apiCall<{ results: RepairApplyResult[] }>(
        `/admin/organization/${encodeURIComponent(
          organizationId,
        )}/feature-repair/apply`,
        {
          method: "POST",
          body: JSON.stringify({ featureIds: [...selectedIds], mode }),
        },
      );
      setApplyResults(res.results);
      // Re-scan so the table reflects the post-fix state
      await runScan();
    } catch (e) {
      setRepairError(e.message);
    }
  };

  // Per-action counts over the current selection. Drift fix only writes
  // features whose live revision is the trustworthy side; corrupt-draft
  // reset only touches features with flagged drafts.
  const selectedFindings = (scanResult?.findings ?? []).filter((f) =>
    selectedIds.has(f.featureId),
  );
  const driftFixCount = selectedFindings.filter(
    (f) => f.drift?.direction === "feature_from_revision",
  ).length;
  const draftResetCount = selectedFindings.reduce(
    (sum, f) => sum + f.corruptDrafts.length,
    0,
  );

  return (
    <Modal
      open={true}
      header={`Feature Repair — ${organizationName} (${organizationId})`}
      close={close}
      closeCta="Close"
      size="max"
      trackingEventModalType=""
    >
      <Callout status="warning" mb="3">
        Superadmin tool: detects features and revisions stored in inconsistent
        or legacy shapes for this organization and repairs them. Always review
        the dry run before applying.
      </Callout>
      <div className="row align-items-center mb-3">
        <div className="col-auto">
          <button
            className="btn btn-outline-primary"
            disabled={scanning}
            onClick={(e) => {
              e.preventDefault();
              runScan();
            }}
          >
            {scanning ? <LoadingSpinner /> : <FaSearch />} Re-scan
          </button>
        </div>
        {scanResult && selectableIds.length > 0 && (
          <>
            <div className="col-auto">
              <button
                className="btn btn-outline-primary"
                disabled={dryRunLoading || selectedIds.size === 0}
                onClick={(e) => {
                  e.preventDefault();
                  runDryRun(1);
                }}
              >
                {dryRunLoading ? <LoadingSpinner /> : null} Dry Run (
                {selectedIds.size})
              </button>
            </div>
            <div className="col-auto">
              <ConfirmButton
                onClick={() => runApply("drift")}
                modalHeader="Fix drift"
                confirmationText={`This rewrites ${driftFixCount} feature doc(s) in ${organizationId} from their live revisions — the exact same self-heal production runs on feature page load — and writes an audit entry for each. Features whose live revision looks sparse are skipped. Continue?`}
                cta="Fix drift"
                isDestructive={true}
                disabled={driftFixCount === 0}
              >
                <button
                  className="btn btn-danger"
                  disabled={driftFixCount === 0}
                >
                  Fix Drift ({driftFixCount})
                </button>
              </ConfirmButton>
            </div>
            <div className="col-auto">
              <ConfirmButton
                onClick={() => runApply("corruptDrafts")}
                modalHeader="Repair corrupt drafts"
                confirmationText={`This repairs ${draftResetCount} corrupt draft(s) in ${organizationId} by restoring rules ONLY in the wiped environments — replayed from the draft's edit logs when unambiguous, otherwise from the live state. Other draft edits are preserved. Status returns to "draft" and an explanatory comment is added. Review the dry run for each draft's plan first. Continue?`}
                cta="Repair drafts"
                isDestructive={true}
                disabled={draftResetCount === 0}
              >
                <button
                  className="btn btn-danger"
                  disabled={draftResetCount === 0}
                >
                  Repair Corrupt Drafts ({draftResetCount})
                </button>
              </ConfirmButton>
            </div>
          </>
        )}
      </div>

      {repairError && (
        <Callout status="error" mb="3">
          {repairError}
        </Callout>
      )}

      {applyResults && (
        <div className="mb-4">
          <h4>Repair results</h4>
          <table className="table appbox">
            <thead>
              <tr>
                <th>Feature</th>
                <th>Status</th>
                <th>Actions taken</th>
              </tr>
            </thead>
            <tbody>
              {applyResults.map((r) => (
                <tr key={r.featureId}>
                  <td>{r.featureId}</td>
                  <td
                    className={
                      r.status === "error" ? "text-danger" : "text-success"
                    }
                  >
                    {r.status}
                    {r.error ? `: ${r.error}` : ""}
                  </td>
                  <td>{r.actions.join("; ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {scanResult && (
        <div className="mb-4">
          <h4>
            Scan:{" "}
            {
              scanResult.findings.filter((f) => findingIssues(f).length > 0)
                .length
            }{" "}
            of {scanResult.featuresScanned} feature(s) with inconsistencies
            {scanResult.findings.some((f) => findingIssues(f).length === 0) && (
              <small className="text-muted ml-2">
                (
                {
                  scanResult.findings.filter(
                    (f) => findingIssues(f).length === 0,
                  ).length
                }{" "}
                more with benign legacy shapes)
              </small>
            )}
          </h4>
          {scanResult.findings.length === 0 ? (
            <Callout status="success">
              No inconsistent features found in this organization.
            </Callout>
          ) : (
            <>
              <Code
                language="json"
                code={stringify(scanResult.summary)}
                expandable={false}
              />
              {selectableIds.length > 0 && (
                <div className="d-flex align-items-center mb-2">
                  <Checkbox
                    label={`Select all (${selectedIds.size}/${selectableIds.length} selected)`}
                    weight="regular"
                    value={
                      selectedIds.size === selectableIds.length
                        ? true
                        : selectedIds.size === 0
                          ? false
                          : "indeterminate"
                    }
                    setValue={(checked) => {
                      setSelectedIds(
                        checked ? new Set(selectableIds) : new Set(),
                      );
                    }}
                  />
                  <span className="ml-3 text-muted">Select only:</span>
                  <a
                    href="#"
                    className="ml-2"
                    onClick={(e) => {
                      e.preventDefault();
                      setSelectedIds(new Set(driftFixableIds));
                    }}
                  >
                    fixable drift ({driftFixableIds.length})
                  </a>
                  <a
                    href="#"
                    className="ml-3"
                    onClick={(e) => {
                      e.preventDefault();
                      setSelectedIds(new Set(corruptDraftIds));
                    }}
                  >
                    corrupt drafts ({corruptDraftIds.length})
                  </a>
                </div>
              )}
              <table className="table appbox">
                <thead>
                  <tr>
                    <th style={{ width: 30 }} />
                    <th>Feature</th>
                    <th>Revision</th>
                    <th>Data shape</th>
                    <th>Last updated</th>
                    <th>Issues</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {[...scanResult.findings]
                    .sort(
                      (a, b) =>
                        // Real inconsistencies first, legacy-shape-only last
                        Math.sign(findingIssues(b).length) -
                        Math.sign(findingIssues(a).length),
                    )
                    .map((f) => (
                      <tr key={f.featureId}>
                        <td>
                          {findingIssues(f).length > 0 && (
                            <Checkbox
                              value={selectedIds.has(f.featureId)}
                              setValue={(checked) => {
                                setSelectedIds((prev) => {
                                  const next = new Set(prev);
                                  if (checked) {
                                    next.add(f.featureId);
                                  } else {
                                    next.delete(f.featureId);
                                  }
                                  return next;
                                });
                              }}
                            />
                          )}
                        </td>
                        <td>
                          <a
                            href={`/features/${f.featureId}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {f.featureId}
                          </a>
                          {f.archived ? " (archived)" : ""}
                        </td>
                        <td>v{f.version}</td>
                        <td className="text-nowrap">
                          feat: <code>{f.featureDocShape}</code>
                          {" · "}
                          rev:{" "}
                          <code>{f.liveRevisionDocShape ?? "missing"}</code>
                        </td>
                        <td>{f.dateUpdated ? date(f.dateUpdated) : "-"}</td>
                        <td>
                          {findingIssues(f).map((issue) =>
                            issue.version !== undefined ? (
                              <a
                                key={issue.label}
                                href={`/features/${f.featureId}?v=${issue.version}`}
                                target="_blank"
                                rel="noreferrer"
                                className="badge badge-warning mr-1"
                              >
                                {issue.label}
                              </a>
                            ) : (
                              <span
                                key={issue.label}
                                className="badge badge-warning mr-1"
                              >
                                {issue.label}
                              </span>
                            ),
                          )}
                        </td>
                        <td>
                          {findingNoteLabels(f).map((label) => (
                            <span
                              key={label}
                              className="badge badge-light mr-1"
                            >
                              {label}
                            </span>
                          ))}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {proposals && (
        <div className="mb-4">
          <h4>Dry run: proposed repairs ({dryRunTotal} feature(s) affected)</h4>
          {proposals.map((p) => (
            <div key={p.finding.featureId} className="appbox p-3 mb-3 bg-white">
              <h5>
                <a
                  href={`/features/${p.finding.featureId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {p.finding.featureId}
                </a>{" "}
                <small className="text-muted">v{p.finding.version}</small>
              </h5>
              <ul>
                {p.notes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
              {p.feature.defaultValue && (
                <p>
                  Default value: <code>{p.feature.defaultValue.before}</code>{" "}
                  &rarr; <code>{p.feature.defaultValue.after}</code>
                </p>
              )}
              {p.feature.rules && (
                <Collapsible
                  trigger={
                    <div className="link-purple">
                      <FaAngleRight /> Feature rules before / after
                    </div>
                  }
                  transitionTime={100}
                >
                  <div className="row">
                    <div className="col-6">
                      <Code
                        language="json"
                        code={stringify(p.feature.rules.before)}
                      />
                    </div>
                    <div className="col-6">
                      <Code
                        language="json"
                        code={stringify(p.feature.rules.after)}
                      />
                    </div>
                  </div>
                </Collapsible>
              )}
            </div>
          ))}
          {dryRunTotal > DRY_RUN_PER_PAGE && (
            <Pagination
              numItemsTotal={dryRunTotal}
              perPage={DRY_RUN_PER_PAGE}
              currentPage={dryRunPage}
              onPageChange={(p) => {
                runDryRun(p);
              }}
            />
          )}
        </div>
      )}
    </Modal>
  );
};

export default FeatureRepairModal;
