import { useFeatureIsOn } from "@growthbook/growthbook-react";
import { ApiAutoRun, autoRunMetaString } from "shared/validators";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import useApi from "@/hooks/useApi";
import { useUser } from "@/services/UserContext";

// Surfaces the auto run this user last started, so coming back to GrowthBook picks
// up where the wizard left off instead of starting from an empty Get Started page.
export default function AutoRunCallout() {
  const { userId } = useUser();
  const aiOnboarding = useFeatureIsOn("ai-assisted-onboarding");
  const { data } = useApi<{ autoRuns: ApiAutoRun[] }>("/auto-runs", {
    shouldRun: () => aiOnboarding,
  });
  if (!aiOnboarding) return null;

  const mine = (data?.autoRuns || [])
    .filter((r) => r.createdBy === userId)
    .sort((a, b) => (a.dateCreated < b.dateCreated ? 1 : -1));

  const run = mine[0];
  if (!run) return null;

  const unfinished = run.checks.filter((c) => !c.ok && c.required).length;
  const appName = autoRunMetaString(run.metadata, "appName");
  const where = appName ? ` in ${appName}` : "";

  const body = (
    <Text size="md">
      {unfinished
        ? `Your GrowthBook setup${where} has ${unfinished} required check${
            unfinished === 1 ? "" : "s"
          } to review.`
        : `Review the results of your GrowthBook setup${where}.`}{" "}
      <Link href={`/auto-runs/${run.id}`}>View report</Link>
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
