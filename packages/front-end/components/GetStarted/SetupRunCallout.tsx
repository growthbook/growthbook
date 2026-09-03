import { ApiSetupRun, setupRunMetaString } from "shared/validators";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import useApi from "@/hooks/useApi";
import { useUser } from "@/services/UserContext";

// Surfaces the setup run this user last started, so coming back to GrowthBook picks
// up where the wizard left off instead of starting from an empty Get Started page.
export default function SetupRunCallout() {
  const { userId } = useUser();
  const { data } = useApi<{ setupRuns: ApiSetupRun[] }>("/setup-runs");

  const mine = (data?.setupRuns || [])
    .filter((r) => r.createdBy === userId)
    .sort((a, b) => (a.dateCreated < b.dateCreated ? 1 : -1));

  const run = mine[0];
  if (!run) return null;

  const unfinished = run.checks.filter((c) => !c.ok && c.required).length;
  const appName = setupRunMetaString(run.metadata, "appName");
  const where = appName ? ` in ${appName}` : "";

  return (
    <Callout status={unfinished ? "warning" : "success"} size="md" mb="4">
      <Text size="medium">
        {unfinished
          ? `Your GrowthBook setup${where} has ${unfinished} step${
              unfinished === 1 ? "" : "s"
            } left to finish.`
          : `You set up GrowthBook${where}. Here's everything it created.`}{" "}
        <Link href={`/setup-runs/${run.id}`}>View setup</Link>
      </Text>
    </Callout>
  );
}
