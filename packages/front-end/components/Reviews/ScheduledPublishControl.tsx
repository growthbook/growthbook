import { ReactNode, useEffect, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { format } from "date-fns";
import { PiClockFill, PiLock } from "react-icons/pi";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Checkbox from "@/ui/Checkbox";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import DatePicker from "@/components/DatePicker";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import SelectField from "@/components/Forms/SelectField";
import NoticeBanner from "@/components/Reviews/NoticeBanner";

type Mode = "approve" | "date";

function toIso(d: Date | string | null | undefined): string {
  if (!d) return "";
  const parsed = new Date(d as Date | string);
  return isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

// Structural shape of the revision-like data this control reads. Satisfied by
// both the generic Revision and the feature FeatureRevisionInterface, so the
// same control can drive saved groups now and feature flags later.
export interface ScheduleControlRevision {
  status: string;
  autoPublishOnApproval?: boolean;
  scheduledPublishAt?: Date | string | null;
  scheduledPublishLockEdits?: boolean;
  scheduledPublishLockOthers?: boolean;
  scheduledPublishBypassApproval?: boolean;
  scheduledPublishLastError?: string;
  // Set when the poller gave up on a failing scheduled publish; the schedule was
  // cleared and the draft left open.
  scheduledPublishGaveUpAt?: Date | string | null;
}

function getLockTargets(
  revision: ScheduleControlRevision,
  entityNoun: string,
): string {
  const lockEdits = !!revision.scheduledPublishLockEdits;
  const lockOthers = !!revision.scheduledPublishLockOthers;
  if (lockOthers && lockEdits) {
    return `this draft and other drafts of this ${entityNoun}`;
  }
  if (lockOthers) return `other drafts of this ${entityNoun}`;
  return lockEdits ? "this draft" : "";
}

export default function ScheduledPublishControl({
  revision,
  pending,
  lockActive,
  schedulePublishPath,
  toggleAutoPublishPath,
  entityNoun,
  canEdit,
  canArm = true,
  canCancel,
  canDraft,
  canBypassApproval,
  requiresApproval,
  autopublishOnApproval,
  approvalsCoverChange,
  dateNote,
  onStagedScheduleChange,
  mutate,
}: {
  revision: ScheduleControlRevision;
  // Schedule is armed and still awaiting its fire time (caller derives this
  // from its entity's isScheduledPublishPending helper).
  pending: boolean;
  // The schedule's edit/other locks are currently in force (caller derives this
  // from its entity's isScheduledPublishLockActive helper).
  lockActive: boolean;
  // POST endpoint for arming/updating/clearing a dated schedule. Body is
  // { scheduledPublishAt, lockEdits, lockOthers, bypassApproval } to arm, or
  // { scheduledPublishAt: null } to clear.
  schedulePublishPath: string;
  // POST endpoint for arming/disarming "publish when approved". Body { enabled }.
  toggleAutoPublishPath: string;
  // Noun for the lock scope option ("this {entityNoun}"), e.g. "Saved Group".
  entityNoun: string;
  // The viewer has publish authority over this entity.
  canEdit: boolean;
  /** False when new schedules are refused but an existing one may still be cancelled. */
  canArm?: boolean;
  /**
   * Cancelling. The endpoint judges it on coarse live-entity publish authority,
   * so a change-aware `canEdit` must not hide it. Defaults to `canEdit`.
   */
  canCancel?: boolean;
  // Draft authority, for the "when approved" arm; defaults to permitted for
  // callers whose canEdit already folds it in.
  canDraft?: boolean;
  // The viewer can bypass the approval requirement (admin).
  canBypassApproval: boolean;
  // Approval is required for this revision.
  requiresApproval: boolean;
  // The org has auto-publish-on-approval enabled (gates the "when approved" mode).
  autopublishOnApproval: boolean;
  /**
   * Whether the standing approvals cover what the revision changes. An approved
   * revision they don't cover is still waiting on a qualifying approval, so
   * "when approved" remains meaningful there. Defaults to true.
   */
  approvalsCoverChange?: boolean;
  // Optional extra note rendered under the date controls (e.g. the feature
  // flow's "linked experiments won't start" warning).
  dateNote?: ReactNode;
  /**
   * Reports a dated schedule the user has configured but that could NOT be
   * persisted yet — a review-required draft, whose schedule endpoint refuses
   * to arm until review is requested. The caller sends it with its
   * request-review call so the intent isn't silently dropped.
   */
  onStagedScheduleChange?: (
    staged: {
      scheduledPublishAt: string;
      lockEdits: boolean;
      lockOthers: boolean;
    } | null,
  ) => void;
  mutate: () => void | Promise<void>;
}) {
  const { apiCall } = useAuth();
  const { hasCommercialFeature } = useUser();
  const hasScheduledRevisions = hasCommercialFeature("scheduled-revisions");

  const status = revision.status;
  const persistedArmed = !!revision.autoPublishOnApproval;
  const scheduledAtIso = toIso(revision.scheduledPublishAt);
  const isScheduled = persistedArmed && !!scheduledAtIso;
  const scheduleArmedByAdmin =
    pending && !!revision.scheduledPublishBypassApproval;

  // ── Parity with the feature derivations ──
  // Both modes answer one question — when does this publish — so they share one
  // gate: publish authority, which is what the arming endpoints take. Arming on a
  // DRAFT is staged and applied by request-review, so that path needs draft
  // authority too.
  const canArmSchedule =
    canEdit && canArm && (status !== "draft" || (canDraft ?? true));
  // "when approved" only makes sense while the revision still needs an approval
  // to publish: before approval, or approved by someone whose rights don't cover
  // what it changes. Once it can publish, Publish already does that.
  const awaitingQualifyingApproval =
    status !== "approved" || approvalsCoverChange === false;
  const canArmWhenApproved =
    autopublishOnApproval && canArmSchedule && awaitingQualifyingApproval;
  // Premium gates the picker render below, not the option itself.
  const canArmOnDate = canArmSchedule;
  // Disarming an already-armed no-date schedule survives the gates on ARMING
  // (org setting off, `canArm` false on a locked Config) — the endpoint asks for
  // publish authority alone on the way out, and hiding the checkbox would strand
  // the armed revision. Same term as the feature sibling.
  const canDisarmWhenApproved = persistedArmed && canEdit;
  const canManageAutoPublish =
    canArmWhenApproved || canArmOnDate || canDisarmWhenApproved;
  // The schedule's admin bypass is only relevant when the revision would
  // otherwise need approval (review required, not yet approved).
  const canBypassScheduleApproval =
    canBypassApproval && requiresApproval && status !== "approved";

  const [armed, setArmed] = useState(persistedArmed);
  const [mode, setMode] = useState<Mode>(scheduledAtIso ? "date" : "approve");
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(scheduledAtIso);
  // Unified lock model (matches the feature flow): one "enabled" checkbox + a
  // scope. lockEdits = enabled; lockOthers = enabled && scope === "feature".
  const [lockEnabled, setLockEnabled] = useState(
    !!revision.scheduledPublishLockEdits ||
      !!revision.scheduledPublishLockOthers,
  );
  const [lockScope, setLockScope] = useState<"draft" | "feature">(
    revision.scheduledPublishLockOthers ? "feature" : "draft",
  );
  const lockEdits = lockEnabled;
  const lockOthers = lockEnabled && lockScope === "feature";
  const [bypass, setBypass] = useState(
    !!revision.scheduledPublishBypassApproval,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-sync local controls from the persisted values. Keyed on the values so an
  // in-progress edit isn't clobbered when an auto-save's mutate() returns a new
  // revision object whose values already match (mirrors the feature flow) — AND
  // on the schedule path, which carries the revision identity: two revisions
  // with identical schedule values would otherwise skip the resync entirely and
  // hand the next revision this one's unsaved edits.
  useEffect(() => {
    setArmed(!!revision.autoPublishOnApproval);
    setMode(revision.scheduledPublishAt ? "date" : "approve");
    setDate(toIso(revision.scheduledPublishAt));
    setLockEnabled(
      !!revision.scheduledPublishLockEdits ||
        !!revision.scheduledPublishLockOthers,
    );
    setLockScope(revision.scheduledPublishLockOthers ? "feature" : "draft");
    setBypass(!!revision.scheduledPublishBypassApproval);
  }, [
    schedulePublishPath,
    revision.autoPublishOnApproval,
    revision.scheduledPublishAt,
    revision.scheduledPublishLockEdits,
    revision.scheduledPublishLockOthers,
    revision.scheduledPublishBypassApproval,
  ]);

  // Collapse back to the read-only summary only when switching revisions — keyed
  // on the schedule endpoint (which carries the revision id/version) so an
  // auto-saved change doesn't collapse the form mid-edit (matches the feature
  // flow's version-keyed reset).
  useEffect(() => {
    setEditing(false);
    setError(null);
  }, [schedulePublishPath]);

  // "when approved" collapses to "date" whenever it's unavailable.
  const effectiveMode: Mode = canArmWhenApproved ? mode : "date";

  // A draft that still requires approval (without an admin bypass) can't have a
  // dated schedule persisted — the backend rejects it ("request review first").
  // Mirrors the feature `schedulePersistsImmediately` gate so we only auto-save
  // when the backend will accept it; engaging the admin bypass flips it true.
  const schedulePersistsImmediately =
    status !== "draft" ||
    !requiresApproval ||
    (canBypassScheduleApproval && bypass);

  const lockTargets = getLockTargets(revision, entityNoun);

  // ── Persistence ──
  const doDisarm = async () => {
    setArmed(false);
    // Nothing persisted yet (local intent only) — just collapse the form.
    if (!isScheduled && !persistedArmed) return;
    setError(null);
    try {
      if (isScheduled) {
        await apiCall(schedulePublishPath, {
          method: "POST",
          body: JSON.stringify({ scheduledPublishAt: null }),
        });
      } else {
        await apiCall(toggleAutoPublishPath, {
          method: "POST",
          body: JSON.stringify({ enabled: false }),
        });
      }
      await mutate();
    } catch (e) {
      setError((e as Error).message || "Failed to update");
    }
  };

  // Arm "publish when approved" (no date) — persists immediately.
  const doArmApprove = async () => {
    setError(null);
    try {
      await apiCall(toggleAutoPublishPath, {
        method: "POST",
        body: JSON.stringify({ enabled: true }),
      });
      await mutate();
    } catch (e) {
      setError((e as Error).message || "Failed to arm auto-publish");
      // Rethrown so the caller can undo its optimistic check.
      throw e;
    }
  };

  // Save a dated schedule (arm or re-arm). Called automatically by the control
  // change handlers below — there is no explicit "save" button.
  const persistSchedule = async (
    d: string,
    le: boolean,
    lo: boolean,
    by: boolean,
  ) => {
    if (!d) return;
    setSaving(true);
    setError(null);
    try {
      await apiCall(schedulePublishPath, {
        method: "POST",
        body: JSON.stringify({
          scheduledPublishAt: d,
          lockEdits: le,
          lockOthers: lo,
          bypassApproval: canBypassScheduleApproval ? by : false,
        }),
      });
      await mutate();
    } catch (e) {
      setError((e as Error).message || "Failed to schedule publish");
    } finally {
      setSaving(false);
    }
  };

  // Push the staged schedule up whenever it changes and cannot be persisted
  // here. Cleared (null) the moment it CAN be — the endpoint then owns it, and
  // a stale staged copy riding a later submit would re-arm something already
  // handled.
  useEffect(() => {
    if (!onStagedScheduleChange) return;
    const stageable =
      armed &&
      !!date &&
      !schedulePersistsImmediately &&
      effectiveMode === "date";
    onStagedScheduleChange(
      stageable
        ? {
            scheduledPublishAt: date,
            lockEdits,
            lockOthers,
          }
        : null,
    );
  }, [
    armed,
    date,
    lockEdits,
    lockOthers,
    schedulePersistsImmediately,
    effectiveMode,
    onStagedScheduleChange,
  ]);

  // Auto-save the current dated config, but only when the backend will accept
  // it (see schedulePersistsImmediately). `persists` and `isArmed` let a
  // handler mid-toggle pass its about-to-be-set value — the state read here is
  // stale inside the same handler.
  const persistIfReady = (
    d: string,
    le: boolean,
    lo: boolean,
    by: boolean,
    persists = schedulePersistsImmediately,
    isArmed = armed,
  ) => {
    if (isArmed && d && persists) {
      void persistSchedule(d, le, lo, by);
    }
  };

  const onToggleArmed = (checked: boolean) => {
    setArmed(checked);
    if (!checked) {
      void doDisarm();
      return;
    }
    if (effectiveMode === "approve") {
      // Only reachable when canArmWhenApproved — persist immediately, and
      // revert the optimistic check if the request fails.
      void doArmApprove().catch(() => setArmed(false));
      return;
    }
    // "date" mode: keep the controls open while configuring; persist now only
    // if a date is already chosen and the backend will accept it.
    setEditing(true);
    persistIfReady(
      date,
      lockEdits,
      lockOthers,
      bypass,
      schedulePersistsImmediately,
      checked,
    );
  };

  const onModeChange = (m: Mode) => {
    setMode(m);
    if (!armed) return;
    if (m === "approve") {
      // Switch from a dated schedule to "when approved": clear any pending date,
      // then arm approve. (Canceling the schedule disarms, so re-arm after.)
      void (async () => {
        setError(null);
        try {
          if (isScheduled) {
            await apiCall(schedulePublishPath, {
              method: "POST",
              body: JSON.stringify({ scheduledPublishAt: null }),
            });
          }
          await apiCall(toggleAutoPublishPath, {
            method: "POST",
            body: JSON.stringify({ enabled: true }),
          });
          await mutate();
        } catch (e) {
          setError((e as Error).message || "Failed to update");
        }
      })();
    } else {
      persistIfReady(date, lockEdits, lockOthers, bypass);
    }
  };

  const onDateChange = (iso: string) => {
    setDate(iso);
    persistIfReady(iso, lockEdits, lockOthers, bypass);
  };

  const onLockToggle = (value: boolean) => {
    setLockEnabled(value);
    persistIfReady(date, value, value && lockScope === "feature", bypass);
  };

  const onLockScopeChange = (scope: "draft" | "feature") => {
    setLockScope(scope);
    // Mirror the publish-mode selector: changing scope while the lock is off
    // only records the preference; it doesn't enable the lock.
    if (lockEnabled) {
      persistIfReady(date, true, scope === "feature", bypass);
    }
  };

  const onBypassToggle = (v: boolean) => {
    setBypass(v);
    // Engaging bypass flips schedulePersistsImmediately true for a review-required
    // draft, so recompute the gate with the new value — toggling it on arms the
    // schedule immediately. (Only reachable when canBypassScheduleApproval; the
    // box is hidden otherwise.)
    const persists =
      status !== "draft" ||
      !requiresApproval ||
      (canBypassScheduleApproval && v);
    persistIfReady(date, lockEdits, lockOthers, v, persists);
  };

  // ── Read-only summary: a committed dated schedule (always for admin-armed,
  // which is cancel-and-re-arm only). Shown to everyone so the schedule is
  // visible; only managers get Change/Cancel. Uses the shared NoticeBanner so
  // it reads identically to the feature-flow scheduled-publish card. ──
  if (isScheduled && (!editing || scheduleArmedByAdmin)) {
    return (
      <Box mb="3">
        <NoticeBanner
          icon={<PiClockFill />}
          iconColor="violet"
          title="Scheduled to publish"
          body={
            <>
              {format(new Date(scheduledAtIso), "PPp")}
              {pending && !lockActive ? " · pending approval" : ""}
            </>
          }
          footer={
            <>
              {lockTargets && (
                <HelperText status="warning" size="sm" icon={<PiLock />} mt="2">
                  {lockActive ? "Locks " : "Will lock "}
                  {lockTargets}
                </HelperText>
              )}
              {scheduleArmedByAdmin && (
                <HelperText status="info" size="sm" mt="2">
                  Armed by an admin (approval bypassed). Cancel and re-arm to
                  change it.
                </HelperText>
              )}
              {revision.scheduledPublishLastError && (
                <HelperText status="error" size="sm" mt="2">
                  Publish is stuck and keeps retrying:{" "}
                  {revision.scheduledPublishLastError}
                </HelperText>
              )}
            </>
          }
          action={
            (canCancel ?? canEdit) ? (
              <Flex gap="2" align="center">
                {/* Disarming a no-date auto-publish posts to the toggle
                    endpoint, which requires draft authority; the dated cancel
                    needs only publish. */}
                {(isScheduled || (canDraft ?? true)) && (
                  <Button
                    variant="ghost"
                    color="red"
                    size="sm"
                    onClick={doDisarm}
                  >
                    Cancel schedule
                  </Button>
                )}
                {canManageAutoPublish && !scheduleArmedByAdmin && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditing(true)}
                  >
                    Change
                  </Button>
                )}
              </Flex>
            ) : undefined
          }
        />
        {error && (
          <Callout status="error" size="sm" mt="2">
            {error}
          </Callout>
        )}
      </Box>
    );
  }

  // The poller gave up on the previous schedule (cleared on cancel/re-arm); the
  // draft is still open. Shown to every viewer — managers can re-arm to retry.
  const gaveUpNotice = revision.scheduledPublishGaveUpAt ? (
    <HelperText status="error" size="sm" mb="2">
      Could not publish
      {revision.scheduledPublishLastError
        ? `: ${revision.scheduledPublishLastError}`
        : "."}
    </HelperText>
  ) : null;

  // A non-manager viewing a revision armed to "publish when approved" (no date)
  // gets a disabled read-only indicator, mirroring the feature flow; a dated
  // schedule already rendered its card above. Otherwise only an abandoned
  // schedule's failure notice shows.
  if (!canManageAutoPublish) {
    if (persistedArmed) {
      return (
        <Box mb="5">
          {gaveUpNotice}
          <Checkbox
            label="Automatically publish when approved"
            weight="regular"
            disabled
            value={true}
            setValue={() => {}}
          />
        </Box>
      );
    }
    return gaveUpNotice ? <Box mb="5">{gaveUpNotice}</Box> : null;
  }

  // Derive the disabled state and explanation from the same predicate.
  const lockedNoDateArm =
    armed &&
    !isScheduled &&
    persistedArmed &&
    !canDisarmWhenApproved &&
    !canArmWhenApproved;

  return (
    <Box mb="5">
      {gaveUpNotice}
      <Flex align="center" gap="1">
        <Checkbox
          label="Automatically publish"
          weight="regular"
          // Persisted no-date arms require draft authority to disarm.
          disabled={saving || lockedNoDateArm}
          disabledMessage={
            lockedNoDateArm
              ? "You need permission to edit drafts to turn off publish-on-approval."
              : undefined
          }
          value={armed}
          setValue={(val) => onToggleArmed(!!val)}
        />
        {canArmWhenApproved ? (
          <SelectField
            containerClassName="select-dropdown-underline mb-0"
            value={effectiveMode}
            disabled={saving}
            isSearchable={false}
            sort={false}
            containerStyles={{
              control: (s) => ({ ...s, fontSize: 14 }),
              singleValue: (s) => ({ ...s, fontSize: 14 }),
            }}
            options={[
              { label: "when approved", value: "approve" },
              { label: "on a specific date", value: "date" },
            ]}
            onChange={(v) => onModeChange(v as Mode)}
          />
        ) : (
          // A revision that can already publish can only defer to a date —
          // "when approved" would just publish now, so show it as text.
          <Text size="md">on a specific date</Text>
        )}
      </Flex>
      {armed && effectiveMode === "date" && (
        <Box mt="2" ml="4">
          {hasScheduledRevisions ? (
            <>
              <DatePicker
                date={date || undefined}
                setDate={(d) => onDateChange(d ? d.toISOString() : "")}
                precision="datetime"
                disableBefore={new Date().toISOString()}
              />
              <Flex align="center" gap="1" mt="2">
                <Checkbox
                  label="Lock edits to"
                  weight="regular"
                  value={lockEnabled}
                  setValue={(v) => onLockToggle(!!v)}
                />
                <SelectField
                  containerClassName="select-dropdown-underline mb-0"
                  value={lockScope}
                  disabled={saving}
                  isSearchable={false}
                  sort={false}
                  containerStyles={{
                    control: (s) => ({ ...s, fontSize: 14 }),
                    singleValue: (s) => ({ ...s, fontSize: 14 }),
                  }}
                  options={[
                    { label: `this ${entityNoun}`, value: "feature" },
                    { label: "this draft", value: "draft" },
                  ]}
                  onChange={(v) => onLockScopeChange(v as "draft" | "feature")}
                />
              </Flex>
              {canBypassScheduleApproval && (
                <Box mt="2">
                  <Checkbox
                    label={
                      <span style={{ color: "var(--red-11)" }}>
                        Admin: allow scheduled publish to bypass checks
                      </span>
                    }
                    weight="regular"
                    value={bypass}
                    setValue={(v) => onBypassToggle(!!v)}
                  />
                </Box>
              )}
              {dateNote}
            </>
          ) : (
            <PremiumTooltip commercialFeature="scheduled-revisions">
              <Text size="sm" as="div">
                Upgrade to publish on a specific date.
              </Text>
            </PremiumTooltip>
          )}
          {error && (
            <Callout status="error" mt="2">
              {error}
            </Callout>
          )}
        </Box>
      )}
    </Box>
  );
}
