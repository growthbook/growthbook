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

// Shared "arm auto-publish / schedule a publish" control. Lifted line-for-line
// from the feature flow (components/Reviews/Feature/ReviewAndPublish.tsx) so the
// behavior and controls are identical: one "Automatically publish" checkbox + a
// mode dropdown ("when approved" vs "on a specific date" — mutually exclusive on
// the backend), and a "Lock edits to [this {entityNoun} | this draft]" checkbox
// + scope dropdown, where lockEdits = enabled and lockOthers = enabled && scope
// === "feature" (entity scope is the superset).
//
// Entity-agnostic by design (so the feature side can adopt it later): the caller
// supplies the persistence endpoints, the lifecycle flags it derives from its
// own helpers (pending / lockActive), and the entity noun. Key parity points:
//   - There is NO "save"/"schedule" button: every control change (date, lock,
//     scope, admin bypass) auto-persists. Engaging the admin bypass flips
//     `schedulePersistsImmediately` true, so it arms the schedule on toggle.
//   - effectiveMode forces "date" whenever "when approved" isn't available.
//   - The date option is gated on publish authority, NOT the premium flag; the
//     premium gate only swaps the date picker for an upgrade prompt.
//   - An admin can arm a dated schedule that bypasses approval even when the
//     draft isn't approved; that schedule is then cancel-and-re-arm only.
export default function ScheduledPublishControl({
  revision,
  pending,
  lockActive,
  schedulePublishPath,
  toggleAutoPublishPath,
  entityNoun,
  canEdit,
  canBypassApproval,
  requiresApproval,
  autopublishOnApproval,
  isReviewRequester,
  dateNote,
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
  // Noun for the lock scope option ("this {entityNoun}"), e.g. "saved group",
  // "feature".
  entityNoun: string;
  // The viewer has publish authority over this entity.
  canEdit: boolean;
  // The viewer can bypass the approval requirement (admin).
  canBypassApproval: boolean;
  // Approval is required for this revision.
  requiresApproval: boolean;
  // The org has auto-publish-on-approval enabled (gates the "when approved" mode).
  autopublishOnApproval: boolean;
  // The viewer is the draft author / requested this review (gates arming the
  // "when approved" mode — mirrors the feature `isArmingOwner` rule).
  isReviewRequester: boolean;
  // Optional extra note rendered under the date controls (e.g. the feature
  // flow's "linked experiments won't start" warning).
  dateNote?: ReactNode;
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
  const isArmingOwner = canEdit && (status === "draft" || isReviewRequester);
  // "when approved" only makes sense before approval — once approved it would
  // just publish now.
  const canArmWhenApproved =
    autopublishOnApproval && isArmingOwner && status !== "approved";
  // Arming a dated schedule needs only publish authority (premium gates the
  // picker render below, not the option itself).
  const canArmOnDate = canEdit;
  const canManageAutoPublish = canArmWhenApproved || canArmOnDate;
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

  // Re-sync local controls from the persisted values (keyed on the values so an
  // in-progress edit isn't clobbered when an auto-save's mutate() returns a new
  // revision object whose values already match — mirrors the feature flow).
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

  // Lock-target wording: entity-agnostic and explicit about what each lock
  // covers — lockEdits freezes this draft's edits, lockOthers freezes publishing
  // of the other drafts of this {entityNoun}. Single source of truth for both the
  // feature flow and the generic revision flow.
  const lockTargets = (() => {
    const lockEdits = !!revision.scheduledPublishLockEdits;
    const lockOthers = !!revision.scheduledPublishLockOthers;
    if (lockOthers && lockEdits)
      return `this draft and other drafts of this ${entityNoun}`;
    if (lockOthers) return `other drafts of this ${entityNoun}`;
    if (lockEdits) return "this draft";
    return "";
  })();

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

  // Auto-save the current dated config, but only when the backend will accept it
  // (see schedulePersistsImmediately). `persists` lets a handler recompute the
  // gate with its own about-to-be-set value (e.g. the admin bypass toggle).
  const persistIfReady = (
    d: string,
    le: boolean,
    lo: boolean,
    by: boolean,
    persists = schedulePersistsImmediately,
  ) => {
    if (armed && d && persists) {
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
      // Only reachable when canArmWhenApproved — persist immediately.
      void doArmApprove();
      return;
    }
    // "date" mode: keep the controls open while configuring; persist now only
    // if a date is already chosen and the backend will accept it.
    setEditing(true);
    persistIfReady(date, lockEdits, lockOthers, bypass);
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
            canEdit ? (
              <Flex gap="2" align="center">
                <Button
                  variant="ghost"
                  color="red"
                  size="xs"
                  onClick={doDisarm}
                >
                  Cancel schedule
                </Button>
                {canManageAutoPublish && !scheduleArmedByAdmin && (
                  <Button
                    variant="outline"
                    size="xs"
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

  // A non-manager viewing a revision armed to "publish when approved" (no date)
  // gets a disabled read-only indicator, mirroring the feature flow; a dated
  // schedule already rendered its card above. Otherwise there's nothing to show.
  if (!canManageAutoPublish) {
    if (persistedArmed) {
      return (
        <Box mb="5">
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
    return null;
  }

  // ── Editable form (auto-saves on change; no explicit schedule button) ──
  // Unified arming: one checkbox + an inline mode dropdown ("when approved" vs
  // "on a specific date" are mutually exclusive), matching the feature flow.
  return (
    <Box mb="5">
      {revision.scheduledPublishGaveUpAt && (
        // The poller gave up on the previous schedule; the draft is still open,
        // so re-arm below to try again. Clears once re-armed.
        <HelperText status="error" size="sm" mb="2">
          Could not publish
          {revision.scheduledPublishLastError
            ? `: ${revision.scheduledPublishLastError}`
            : "."}
        </HelperText>
      )}
      <Flex align="center" gap="1">
        <Checkbox
          label="Automatically publish"
          weight="regular"
          disabled={saving}
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
          // Approved revisions can only defer to a date — "when approved" would
          // just publish now, so show it as text.
          <Text size="medium">on a specific date</Text>
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
              <Text size="small" as="div">
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
