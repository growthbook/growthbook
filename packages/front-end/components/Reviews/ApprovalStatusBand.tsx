import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { PiSpinnerGap, PiUserCheckBold, PiWarningBold } from "react-icons/pi";
import Link from "@/ui/Link";
import NoticeBanner from "@/components/Reviews/NoticeBanner";

type ApproverTeam = { id: string; name: string };
// One entry per rule; any of its teams satisfies that rule.
type UnmetTeams = ApproverTeam[][];
type ReviewFootprint = { scope: string; environments?: readonly string[] };

// "Finance or Dream Team"
function describeApproverTeams(teams: ApproverTeam[]) {
  return teams.map((t) => t.name).join(" or ");
}

// Every rule must be satisfied; any of a rule's teams satisfies it:
// "Finance and (Payments or Dream Team)".
function describeUnmet(unmet: UnmetTeams) {
  return unmet
    .map((teams) =>
      teams.length > 1 && unmet.length > 1
        ? `(${describeApproverTeams(teams)})`
        : describeApproverTeams(teams),
    )
    .join(" and ");
}

// What a publish will take: what the draft reaches, and who must sign off.
// Both halves are voiced whenever they apply.
function RequirementLine({
  footprint,
  unmet,
}: {
  footprint?: ReviewFootprint;
  unmet: UnmetTeams;
}) {
  const envs =
    footprint?.scope === "environments" ? (footprint.environments ?? []) : null;
  const teams = unmet.length > 0 ? describeUnmet(unmet) : null;
  // Only "everywhere" (a global value change) truly lands in every
  // environment. "unbound" is metadata-only and "any" sanctions nothing, so
  // neither claims reach.
  const reach = envs?.length ? (
    <>
      changes <strong>{envs.join(", ")}</strong>
    </>
  ) : footprint?.scope === "everywhere" ? (
    <>
      changes <strong>every environment</strong>
    </>
  ) : null;

  if (reach) {
    return (
      <div>
        This draft {reach}
        {teams ? <> — requires approval from {teams}.</> : "."}
      </div>
    );
  }
  return teams ? <div>Requires approval from {teams}.</div> : null;
}

// The approval half of the publish lifecycle as one NoticeBanner, sharing the
// chrome of the divergence/conflict notices. Severity follows the phase.
export default function ApprovalStatusBand({
  phase,
  footprint,
  unmet,
  showSelfApprovalNote,
  canRecallReview,
  recallDisabled,
  onRecallReview,
  coverageMessage,
}: {
  // draft: review will be required; waiting: review requested, viewer can't
  // review; gated: approved but a publish gate (teams/coverage) is unmet.
  phase: "draft" | "waiting" | "gated";
  footprint?: ReviewFootprint;
  unmet: UnmetTeams;
  // Only for a contributor who didn't create the draft: the org's
  // self-approval setting blocks them, which isn't self-evident. A sole
  // author already knows they can't approve their own draft.
  showSelfApprovalNote?: boolean;
  canRecallReview?: boolean;
  recallDisabled?: boolean;
  onRecallReview?: () => Promise<void> | void;
  coverageMessage?: string | null;
}) {
  const [recalling, setRecalling] = useState(false);

  const selfApprovalNote = showSelfApprovalNote && (
    <div>You can&apos;t approve a draft you contributed to.</div>
  );
  // A stale/uncovered approval can exist in any phase (e.g. changes were
  // requested after an approval that no longer counts) — always explain it.
  const coverageNote = coverageMessage && <div>{coverageMessage}</div>;

  if (phase === "draft") {
    return (
      <NoticeBanner
        icon={<PiUserCheckBold />}
        iconColor="gray"
        title="Review required to publish"
        body={
          <>
            <RequirementLine footprint={footprint} unmet={unmet} />
            {coverageNote}
            {selfApprovalNote}
          </>
        }
      />
    );
  }

  if (phase === "gated") {
    return (
      <NoticeBanner
        icon={<PiWarningBold />}
        iconColor="amber"
        title="Publishing is blocked"
        body={
          <>
            <RequirementLine footprint={footprint} unmet={unmet} />
            {coverageNote}
          </>
        }
      />
    );
  }

  const inactive = recallDisabled || recalling;
  return (
    <>
      <NoticeBanner
        icon={<PiSpinnerGap />}
        iconColor="amber"
        title="Waiting for a reviewer"
        body={
          <>
            <RequirementLine footprint={footprint} unmet={unmet} />
            {coverageNote}
            {selfApprovalNote}
          </>
        }
      />
      {canRecallReview && onRecallReview && (
        <Flex justify="center" mt="3">
          <Link
            color={inactive ? "gray" : undefined}
            style={inactive ? { pointerEvents: "none" } : undefined}
            aria-disabled={inactive}
            onClick={
              inactive
                ? undefined
                : async () => {
                    setRecalling(true);
                    try {
                      await onRecallReview();
                    } finally {
                      setRecalling(false);
                    }
                  }
            }
          >
            Return to draft state
          </Link>
        </Flex>
      )}
    </>
  );
}
