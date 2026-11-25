import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import type { I18n } from "@lingui/core";
import { msg, plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { PiSpinnerGap, PiUserCheckBold, PiWarningBold } from "react-icons/pi";
import Link from "@/ui/Link";
import NoticeBanner from "@/components/Reviews/NoticeBanner";

type ApproverTeam = { id: string; name: string };
// One entry per rule; any of its teams satisfies that rule.
type UnmetTeams = ApproverTeam[][];
// Targeting projects still owed an approval from one of their own reviewers.
// `name` is null when the viewer cannot read the project.
type UnmetProjects = { id: string; name: string | null }[];
type ReviewFootprint = { scope: string; environments?: readonly string[] };

// "A or B or C" / "A and B and C", one message per join.
function joinOr(items: string[], i18n: I18n) {
  if (items.length === 0) return "";
  return items.reduce((list, item) => i18n._(msg`${list} or ${item}`));
}

function joinAnd(items: string[], i18n: I18n) {
  if (items.length === 0) return "";
  return items.reduce((list, item) => i18n._(msg`${list} and ${item}`));
}

// "Finance or Dream Team"
function describeApproverTeams(teams: ApproverTeam[], i18n: I18n) {
  return joinOr(
    teams.map((team) => team.name),
    i18n,
  );
}

// Every rule must be satisfied; any of a rule's teams satisfies it:
// "Finance and (Payments or Dream Team)".
function describeUnmet(unmet: UnmetTeams, i18n: I18n) {
  return joinAnd(
    unmet.map((teams) =>
      teams.length > 1 && unmet.length > 1
        ? `(${describeApproverTeams(teams, i18n)})`
        : describeApproverTeams(teams, i18n),
    ),
    i18n,
  );
}

// "a reviewer in the Platform Project and a reviewer in the Config Server Project"
function describeProjects(projects: UnmetProjects, i18n: I18n) {
  const named = projects.filter((p) => p.name);
  const hidden = projects.length - named.length;
  return joinAnd(
    [
      ...named.map((p) => {
        const projectName = p.name ?? "";
        return i18n._(msg`a reviewer in the ${projectName} Project`);
      }),
      ...(hidden === 1
        ? [i18n._(msg`a reviewer in a Project you don't have access to`)]
        : hidden > 1
          ? [
              i18n._(
                msg`${plural(hidden, {
                  one: "reviewers in # Project you don't have access to",
                  other: "reviewers in # Projects you don't have access to",
                })}`,
              ),
            ]
          : []),
    ],
    i18n,
  );
}

// What a publish will take: what the draft reaches, and who must sign off.
// Both halves are voiced whenever they apply.
function RequirementLine({
  footprint,
  unmet,
  unmetProjects = [],
}: {
  footprint?: ReviewFootprint;
  unmet: UnmetTeams;
  unmetProjects?: UnmetProjects;
}) {
  const { i18n } = useLingui();
  const envs =
    footprint?.scope === "environments" ? (footprint.environments ?? []) : null;
  const who = [
    unmet.length > 0 ? describeUnmet(unmet, i18n) : null,
    unmetProjects.length > 0 ? describeProjects(unmetProjects, i18n) : null,
  ].filter((part): part is string => !!part);
  const teams = who.length > 0 ? joinAnd(who, i18n) : null;
  // Only "everywhere" (a global value change) truly lands in every
  // environment. "unbound" is metadata-only and "any" sanctions nothing, so
  // neither claims reach.
  const envList = envs?.length ? envs.join(", ") : null;

  if (envList) {
    return (
      <div>
        {teams ? (
          <Trans>
            This draft changes <strong>{envList}</strong> — requires approval
            from {teams}.
          </Trans>
        ) : (
          <Trans>
            This draft changes <strong>{envList}</strong>.
          </Trans>
        )}
      </div>
    );
  }
  if (footprint?.scope === "everywhere") {
    return (
      <div>
        {teams ? (
          <Trans>
            This draft changes <strong>every environment</strong> — requires
            approval from {teams}.
          </Trans>
        ) : (
          <Trans>
            This draft changes <strong>every environment</strong>.
          </Trans>
        )}
      </div>
    );
  }
  return teams ? (
    <div>
      <Trans>Requires approval from {teams}.</Trans>
    </div>
  ) : null;
}

// The approval half of the publish lifecycle as one NoticeBanner, sharing the
// chrome of the divergence/conflict notices. Severity follows the phase.
export default function ApprovalStatusBand({
  phase,
  footprint,
  unmet,
  unmetProjects,
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
  unmetProjects?: UnmetProjects;
  // Only for a contributor who didn't create the draft: the org's
  // self-approval setting blocks them, which isn't self-evident. A sole
  // author already knows they can't approve their own draft.
  showSelfApprovalNote?: boolean;
  canRecallReview?: boolean;
  recallDisabled?: boolean;
  onRecallReview?: () => Promise<void> | void;
  coverageMessage?: string | null;
}) {
  const { t } = useLingui();
  const [recalling, setRecalling] = useState(false);

  const selfApprovalNote = showSelfApprovalNote && (
    <div>
      <Trans>You can&apos;t approve a draft you contributed to.</Trans>
    </div>
  );
  // A stale/uncovered approval can exist in any phase (e.g. changes were
  // requested after an approval that no longer counts) — always explain it.
  const coverageNote = coverageMessage && <div>{coverageMessage}</div>;

  if (phase === "draft") {
    return (
      <NoticeBanner
        icon={<PiUserCheckBold />}
        iconColor="gray"
        title={t`Review required to publish`}
        body={
          <>
            <RequirementLine
              footprint={footprint}
              unmet={unmet}
              unmetProjects={unmetProjects}
            />
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
        title={t`Publishing is blocked`}
        body={
          <>
            <RequirementLine
              footprint={footprint}
              unmet={unmet}
              unmetProjects={unmetProjects}
            />
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
        title={t`Waiting for a reviewer`}
        body={
          <>
            <RequirementLine
              footprint={footprint}
              unmet={unmet}
              unmetProjects={unmetProjects}
            />
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
            <Trans>Return to draft state</Trans>
          </Link>
        </Flex>
      )}
    </>
  );
}
