import { ApiAutoRun, autoRunMetaString } from "shared/validators";
import { Trans, useLingui } from "@lingui/react/macro";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import useApi from "@/hooks/useApi";
import { useUser } from "@/services/UserContext";

// Surfaces the auto run this user last started, so coming back to GrowthBook picks
// up where the wizard left off instead of starting from an empty Get Started page.
export default function AutoRunCallout() {
  const { t } = useLingui();
  const { userId } = useUser();
  const { data } = useApi<{ autoRuns: ApiAutoRun[] }>("/auto-runs");

  const mine = (data?.autoRuns || [])
    .filter((r) => r.createdBy === userId && r.source !== "eppo-import")
    .sort((a, b) => (a.dateCreated < b.dateCreated ? 1 : -1));

  const run = mine[0];
  if (!run) return null;

  const unfinished = run.checks.filter((c) => !c.ok && c.required).length;
  const appName = autoRunMetaString(run.metadata, "appName");
  let message: string;
  if (unfinished) {
    if (appName) {
      message =
        unfinished === 1
          ? t`Your GrowthBook setup in ${appName} has ${unfinished} required check to review.`
          : t`Your GrowthBook setup in ${appName} has ${unfinished} required checks to review.`;
    } else {
      message =
        unfinished === 1
          ? t`Your GrowthBook setup has ${unfinished} required check to review.`
          : t`Your GrowthBook setup has ${unfinished} required checks to review.`;
    }
  } else {
    message = appName
      ? t`Review the results of your GrowthBook setup in ${appName}.`
      : t`Review the results of your GrowthBook setup.`;
  }

  const body = (
    <Text size="md">
      {message}{" "}
      <Link href={`/auto-runs/${run.id}`}>
        <Trans>View report</Trans>
      </Link>
    </Text>
  );

  // A finished run is a recap, so it can be put away; unfinished work keeps its
  // resume cue until it is done.
  return unfinished ? (
    <Callout status="warning" size="md" mb="4">
      {body}
    </Callout>
  ) : (
    <Callout
      status="success"
      size="md"
      mb="4"
      dismissible
      id={`auto-run:${run.id}`}
    >
      {body}
    </Callout>
  );
}
