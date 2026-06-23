import { useEffect, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { format } from "date-fns";
import {
  Revision,
  isScheduledPublishLockActive,
  isScheduledPublishPending,
} from "shared/enterprise";
import { PiClockFill } from "react-icons/pi";
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
  // The admin bypass is only meaningful when the revision would otherwise need
  // approval to publish (review required and not yet approved).
  const canBypassScheduleApproval =
    canBypassApproval && requiresApproval && status !== "approved";

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

  // Re-sync local controls from the persisted values (keyed on the values so
  // they don't flicker on unrelated re-renders).
  useEffect(() => {
    setArmed(!!revision.autoPublishOnApproval);
    setMode(revision.scheduledPublishAt ? "date" : "approve");
    setDate(toIso(revision.scheduledPublishAt));
    setLockEdits(!!revision.scheduledPublishLockEdits);
    setLockOthers(!!revision.scheduledPublishLockOthers);
    setBypass(!!revision.scheduledPublishBypassApproval);
    setEditing(false);
    setError(null);
  }, [
    revision.autoPublishOnApproval,
    revision.scheduledPublishAt,
    revision.scheduledPublishLockEdits,
    revision.scheduledPublishLockOthers,
    revision.scheduledPublishBypassApproval,
  ]);

  // "when approved" collapses to "date" whenever it's unavailable.
  const effectiveMode: Mode = canArmWhenApproved ? mode : "date";

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

  // Save a dated schedule (arm or re-arm).
  const doSchedule = async () => {
    if (rebaseRequired) {
      setError("Rebase this draft with live before scheduling a publish.");
      return;
    }
    if (!date) {
      setError("Pick a date and time first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiCall(`/revision/${revision.id}/schedule-publish`, {
        method: "POST",
        body: JSON.stringify({
          scheduledPublishAt: date,
          lockEdits,
          lockOthers,
          bypassApproval: canBypassScheduleApproval ? bypass : false,
        }),
      });
      setEditing(false);
      await mutate();
    } catch (e) {
      setError((e as Error).message || "Failed to schedule publish");
    } finally {
      setSaving(false);
    }
  };

  const onToggleArmed = (checked: boolean) => {
    setArmed(checked);
    if (!checked) {
      void doDisarm();
    } else if (effectiveMode === "approve") {
      // Only reachable when canArmWhenApproved — persist immediately.
      void doArmApprove();
    }
    // "date" mode: just reveal the controls; doSchedule persists.
  };

  // ── Read-only summary: a committed dated schedule (always for admin-armed,
  // which is cancel-and-re-arm only). Shown to everyone so the schedule is
  // visible; only managers get Change/Cancel. ──
  if (isScheduled && (!editing || scheduleArmedByAdmin)) {
    return (
      <Box mb="3">
        <Callout status={pending && !lockActive ? "warning" : "info"} size="sm">
          <Flex direction="column" gap="1" align="start">
            <Flex align="center" gap="2">
              <PiClockFill />
              <Text size="small" weight="medium">
                Scheduled to publish{" "}
                {format(new Date(scheduledAtIso), "MMM d, yyyy 'at' h:mm a")}
                {pending && !lockActive ? " · pending approval" : ""}
              </Text>
            </Flex>
            {lockTargets && (
              <Text size="small" color="text-low">
                {lockActive ? "Locks" : "Will lock"} {lockTargets} until it
                publishes.
              </Text>
            )}
            {scheduleArmedByAdmin && (
              <Text size="small" color="text-low">
                Armed by an admin (approval bypassed) — cancel to make changes.
              </Text>
            )}
            {revision.scheduledPublishLastError && (
              <HelperText status="error" size="sm">
                Publish is stuck and keeps retrying:{" "}
                {revision.scheduledPublishLastError}
              </HelperText>
            )}
            {canEdit && (
              <Flex gap="2" mt="1">
                {canManageAutoPublish && !scheduleArmedByAdmin && (
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => setEditing(true)}
                  >
                    Change
                  </Button>
                )}
                <Button variant="ghost" size="xs" onClick={doDisarm}>
                  Cancel schedule
                </Button>
              </Flex>
            )}
          </Flex>
        </Callout>
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

  // ── Editable form ──
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
                setValue={(v) => setMode(v as Mode)}
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
                    setDate={(d) => setDate(d ? d.toISOString() : "")}
                    precision="datetime"
                    disableBefore={new Date().toISOString()}
                  />
                  <Box mt="2">
                    <Checkbox
                      label="Freeze edits to this draft while scheduled"
                      weight="regular"
                      value={lockEdits}
                      setValue={(v) => setLockEdits(!!v)}
                    />
                  </Box>
                  {lockEdits && (
                    <Box mt="1" ml="4">
                      <Checkbox
                        label="Also block publishing other drafts until it fires"
                        weight="regular"
                        value={lockOthers}
                        setValue={(v) => setLockOthers(!!v)}
                      />
                    </Box>
                  )}
                  {canBypassScheduleApproval && (
                    <Box mt="2">
                      <Checkbox
                        label={
                          <span style={{ color: "var(--red-11)" }}>
                            Admin: let the scheduled publish bypass approval
                          </span>
                        }
                        weight="regular"
                        value={bypass}
                        setValue={(v) => setBypass(!!v)}
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
                  <Flex gap="2" mt="3">
                    <Button
                      size="sm"
                      onClick={doSchedule}
                      loading={saving}
                      disabled={rebaseRequired}
                    >
                      {isScheduled ? "Update schedule" : "Schedule publish"}
                    </Button>
                    {isScheduled && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing(false)}
                      >
                        Discard changes
                      </Button>
                    )}
                  </Flex>
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
