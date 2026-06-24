import { useEffect, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { format } from "date-fns";
import {
  Revision,
  isScheduledPublishLockActive,
  isScheduledPublishPending,
} from "shared/enterprise";
import { PiClockFill, PiLock } from "react-icons/pi";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Checkbox from "@/ui/Checkbox";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import RadioGroup from "@/ui/RadioGroup";
import DatePicker from "@/components/DatePicker";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import NoticeBanner from "@/components/Reviews/NoticeBanner";

type Mode = "approve" | "date";

function toIso(d: Date | string | null | undefined): string {
  if (!d) return "";
  const parsed = new Date(d as Date | string);
  return isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

// Generic "arm auto-publish / schedule a publish" control for RevisionModel-backed
// entities. Mirrors the feature flow's unified arming model
// (components/Reviews/Feature/ReviewAndPublish.tsx): one "Automatically publish"
// checkbox + a mode that's either "when approved" (autoPublishOnApproval) or "on a
// specific date" (scheduledPublishAt). The two are mutually exclusive on the
// backend. Key parity points:
//   - There is NO "save"/"schedule" button: every control change (date, locks,
//     admin bypass) auto-persists, exactly like the feature flow's onChange
//     handlers. Engaging the admin bypass flips `schedulePersistsImmediately`
//     true, so it arms the schedule on toggle.
//   - effectiveMode forces "date" whenever "when approved" isn't available, so the
//     date controls (and the admin bypass) still render.
//   - The date option is gated on publish authority, NOT the premium flag; the
//     premium gate only swaps the date picker for an upgrade prompt.
//   - An admin can arm a dated schedule that bypasses approval even when the draft
//     isn't approved (scheduledPublishBypassApproval); that schedule is then locked
//     to cancel-and-re-arm.
export default function ScheduledPublishControl({
  revision,
  canEdit,
  canBypassApproval,
  requiresApproval,
  autopublishOnApproval,
  isReviewRequester,
  rebaseRequired = false,
  hasConflicts = false,
  mutate,
}: {
  revision: Revision;
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
  // The draft has diverged from live and the org requires a rebase before
  // publishing (or its approval is stale). A dated schedule fires at a fixed
  // time, so it would hit the rebase gate and fail at publish — block arming
  // one until rebased. "When approved" arming is unaffected: it fires after
  // approval, by which point the draft will have been rebased.
  rebaseRequired?: boolean;
  // The draft has unresolved merge conflicts with live, so it can't be published
  // as-is. Like rebaseRequired, this blocks arming the admin bypass — a bypassing
  // schedule would just fail at its fixed time.
  hasConflicts?: boolean;
  mutate: () => void | Promise<void>;
}) {
  const { apiCall } = useAuth();
  const { hasCommercialFeature } = useUser();
  const hasScheduledRevisions = hasCommercialFeature("scheduled-revisions");

  const status = revision.status;
  const persistedArmed = !!revision.autoPublishOnApproval;
  const scheduledAtIso = toIso(revision.scheduledPublishAt);
  const isScheduled = persistedArmed && !!scheduledAtIso;
  const pending = isScheduledPublishPending(revision);
  const lockActive = isScheduledPublishLockActive(revision);
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
  const canSeeScheduleBypass =
    canBypassApproval && requiresApproval && status !== "approved";
  // ...but you can't arm a bypassing schedule for a draft you couldn't publish:
  // with merge conflicts or a pending rebase, the publish would fail at its
  // scheduled time. Keep the option visible but disabled until it's publishable.
  const publishBlocked = rebaseRequired || hasConflicts;
  const canArmScheduleBypass = canSeeScheduleBypass && !publishBlocked;

  const [armed, setArmed] = useState(persistedArmed);
  const [mode, setMode] = useState<Mode>(scheduledAtIso ? "date" : "approve");
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(scheduledAtIso);
  const [lockEdits, setLockEdits] = useState(
    !!revision.scheduledPublishLockEdits,
  );
  const [lockOthers, setLockOthers] = useState(
    !!revision.scheduledPublishLockOthers,
  );
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
    setLockEdits(!!revision.scheduledPublishLockEdits);
    setLockOthers(!!revision.scheduledPublishLockOthers);
    setBypass(!!revision.scheduledPublishBypassApproval);
  }, [
    revision.autoPublishOnApproval,
    revision.scheduledPublishAt,
    revision.scheduledPublishLockEdits,
    revision.scheduledPublishLockOthers,
    revision.scheduledPublishBypassApproval,
  ]);

  // Collapse back to the read-only summary only when switching revisions — keyed
  // on the id (not the values) so an auto-saved change doesn't collapse the form
  // mid-edit (matches the feature flow's version-keyed reset).
  useEffect(() => {
    setEditing(false);
    setError(null);
  }, [revision.id]);

  // "when approved" collapses to "date" whenever it's unavailable.
  const effectiveMode: Mode = canArmWhenApproved ? mode : "date";

  // A draft that still requires approval (without an admin bypass) can't have a
  // dated schedule persisted — the backend rejects it ("request review first").
  // Mirrors the feature `schedulePersistsImmediately` gate so we only auto-save
  // when the backend will accept it; engaging the admin bypass flips it true.
  const schedulePersistsImmediately =
    status !== "draft" || !requiresApproval || (canArmScheduleBypass && bypass);

  const lockTargets = (() => {
    const parts: string[] = [];
    if (revision.scheduledPublishLockEdits) parts.push("edits to this draft");
    if (revision.scheduledPublishLockOthers) parts.push("other drafts");
    return parts.join(" and ");
  })();

  // ── Persistence ──
  const doDisarm = async () => {
    setArmed(false);
    // Nothing persisted yet (local intent only) — just collapse the form.
    if (!isScheduled && !persistedArmed) return;
    setError(null);
    try {
      if (isScheduled) {
        await apiCall(`/revision/${revision.id}/schedule-publish`, {
          method: "POST",
          body: JSON.stringify({ scheduledPublishAt: null }),
        });
      } else {
        await apiCall(`/revision/${revision.id}/toggle-auto-publish`, {
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
      await apiCall(`/revision/${revision.id}/toggle-auto-publish`, {
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
    if (rebaseRequired) {
      setError("Rebase this draft with live before scheduling a publish.");
      return;
    }
    if (!d) return;
    setSaving(true);
    setError(null);
    try {
      await apiCall(`/revision/${revision.id}/schedule-publish`, {
        method: "POST",
        body: JSON.stringify({
          scheduledPublishAt: d,
          lockEdits: le,
          lockOthers: lo,
          bypassApproval: canArmScheduleBypass ? by : false,
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
            await apiCall(`/revision/${revision.id}/schedule-publish`, {
              method: "POST",
              body: JSON.stringify({ scheduledPublishAt: null }),
            });
          }
          await apiCall(`/revision/${revision.id}/toggle-auto-publish`, {
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

  const onLockEditsToggle = (v: boolean) => {
    const nextOthers = v ? lockOthers : false;
    setLockEdits(v);
    if (!v) setLockOthers(false);
    persistIfReady(date, v, nextOthers, bypass);
  };

  const onLockOthersToggle = (v: boolean) => {
    setLockOthers(v);
    persistIfReady(date, lockEdits, v, bypass);
  };

  const onBypassToggle = (v: boolean) => {
    setBypass(v);
    // Engaging bypass flips schedulePersistsImmediately true for a review-required
    // draft, so recompute the gate with the new value — toggling it on arms the
    // schedule immediately. (Only reachable when canArmScheduleBypass; the box is
    // disabled otherwise.)
    const persists =
      status !== "draft" || !requiresApproval || (canArmScheduleBypass && v);
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

  // Nothing to manage and nothing scheduled → render nothing.
  if (!canManageAutoPublish) return null;

  // ── Editable form (auto-saves on change; no explicit schedule button) ──
  return (
    <Box mb="3">
      <Checkbox
        label="Automatically publish"
        weight="regular"
        value={armed}
        setValue={(v) => onToggleArmed(!!v)}
      />

      {armed && (
        <Box mt="2" ml="4">
          {canArmWhenApproved ? (
            <Flex align="center" gap="2">
              <Text size="small" color="text-mid">
                Publish
              </Text>
              <RadioGroup
                value={mode}
                setValue={(v) => onModeChange(v as Mode)}
                options={[
                  { value: "approve", label: "when it's approved" },
                  { value: "date", label: "on a specific date" },
                ]}
              />
            </Flex>
          ) : (
            <Text size="small" color="text-mid">
              Publishes on a specific date.
            </Text>
          )}

          {effectiveMode === "date" && (
            <Box mt="2">
              {hasScheduledRevisions ? (
                <>
                  <DatePicker
                    date={date || undefined}
                    setDate={(d) => onDateChange(d ? d.toISOString() : "")}
                    precision="datetime"
                    disableBefore={new Date().toISOString()}
                  />
                  <Box mt="2">
                    <Checkbox
                      label="Freeze edits to this draft while scheduled"
                      weight="regular"
                      disabled={saving}
                      value={lockEdits}
                      setValue={(v) => onLockEditsToggle(!!v)}
                    />
                  </Box>
                  {lockEdits && (
                    <Box mt="1" ml="4">
                      <Checkbox
                        label="Also block publishing other drafts until it fires"
                        weight="regular"
                        disabled={saving}
                        value={lockOthers}
                        setValue={(v) => onLockOthersToggle(!!v)}
                      />
                    </Box>
                  )}
                  {canSeeScheduleBypass && (
                    <Box mt="2">
                      <Checkbox
                        label={
                          <span style={{ color: "var(--red-11)" }}>
                            Admin: let the scheduled publish bypass approval
                          </span>
                        }
                        weight="regular"
                        disabled={!canArmScheduleBypass || saving}
                        disabledMessage={
                          publishBlocked
                            ? hasConflicts
                              ? "Resolve the merge conflicts first."
                              : "Rebase this draft with live first."
                            : undefined
                        }
                        value={canArmScheduleBypass && bypass}
                        setValue={(v) => onBypassToggle(!!v)}
                      />
                    </Box>
                  )}
                  {rebaseRequired && (
                    <HelperText status="warning" size="sm" mt="2">
                      Rebase this draft with live before scheduling — a
                      scheduled publish fires at a fixed time and would fail
                      while the draft is behind.
                    </HelperText>
                  )}
                  {date && !schedulePersistsImmediately && !rebaseRequired && (
                    <HelperText status="info" size="sm" mt="2">
                      Request review before scheduling this draft&apos;s publish
                      {canArmScheduleBypass
                        ? ", or enable the admin bypass above to arm it now."
                        : "."}
                    </HelperText>
                  )}
                </>
              ) : (
                <PremiumTooltip commercialFeature="scheduled-revisions">
                  <Text size="small" as="div">
                    Upgrade to publish on a specific date.
                  </Text>
                </PremiumTooltip>
              )}
            </Box>
          )}

          {error && (
            <Callout status="error" size="sm" mt="2">
              {error}
            </Callout>
          )}
        </Box>
      )}
    </Box>
  );
}
