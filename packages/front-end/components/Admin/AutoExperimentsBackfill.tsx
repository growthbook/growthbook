import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";

type Pass = { updated: number; remaining: number };

// Sets the AI Visual Editor and URL redirect opt-ins on organizations that
// predate them, to match what each already uses.
export default function AutoExperimentsBackfill({
  canRun,
}: {
  canRun: boolean;
}) {
  const { apiCall } = useAuth();
  const { data, error, mutate } = useApi<{ remaining: number }>(
    "/admin/auto-experiments/backfill",
  );
  const [updated, setUpdated] = useState<number | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const left = remaining ?? data?.remaining ?? null;

  const run = async () => {
    let total = 0;
    setUpdated(0);
    try {
      // Each call is one pass; a pass that updates nothing means the rest
      // can't be updated, so stop rather than loop.
      for (;;) {
        const pass = await apiCall<Pass>("/admin/auto-experiments/backfill", {
          method: "POST",
        });
        total += pass.updated;
        setUpdated(total);
        setRemaining(pass.remaining);
        if (!pass.remaining || !pass.updated) break;
      }
    } finally {
      // A failed pass may still have updated some, so read the count again.
      setRemaining(null);
      await mutate();
    }
  };

  return (
    <Frame>
      <Flex direction="column" gap="3" align="start">
        <Heading as="h3" size="md">
          Auto Experiment Opt-ins
        </Heading>
        <Text as="div">
          Sets the AI Visual Editor and URL redirect opt-ins on each
          organization that has none saved, to match what it already uses.
        </Text>
        {error ? <Callout status="error">{error.message}</Callout> : null}
        {runError ? <Callout status="error">{runError}</Callout> : null}
        {left !== null ? (
          <Text as="div" weight="semibold">
            {left === 0
              ? "No organizations left to update."
              : `${left} organization${left === 1 ? "" : "s"} left to update.`}
            {updated !== null ? ` ${updated} updated in this run.` : ""}
          </Text>
        ) : null}
        <Tooltip
          content="Only a full super admin can run this"
          enabled={!canRun}
        >
          <Button
            onClick={run}
            setError={setRunError}
            disabled={!canRun || left === 0}
          >
            Run backfill
          </Button>
        </Tooltip>
      </Flex>
    </Frame>
  );
}
