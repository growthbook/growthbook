import { useCallback, useEffect, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import LoadingOverlay from "@/components/LoadingOverlay";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import ErrorDisplay from "@/ui/ErrorDisplay";
import Text from "@/ui/Text";
import { StoryMeta } from "@/ui/storyMeta";

export const meta: StoryMeta = {
  name: "Loading and errors",
  category: "patterns",
  status: "stable",
  summary:
    "Handle the three states of a request in a fixed order. Show the error in a `Callout` first, then a `LoadingOverlay` until data arrives, then the content.",
  useWhen: [
    "A page or section reads data with `useApi`.",
    "A failed save has technical details worth showing. Use `ErrorDisplay`.",
  ],
  avoidWhen: [
    {
      reason: "The request loaded but returned no items.",
      use: "Empty state",
    },
    {
      reason: "The error comes from a modal submit. Throw it instead.",
      use: "Form in a modal",
    },
  ],
  related: ["Callout", "ErrorDisplay", "Empty state"],
  examples: ["pages/metric/[mid].tsx", "pages/report/[rid].tsx"],
};

type Outcome = "success" | "error";
type Result = { data?: string[]; error?: Error };

// Stands in for useApi: data is undefined while loading.
function useFakeApi(outcome: Outcome) {
  const [result, setResult] = useState<Result>({});
  const load = useCallback(() => {
    setResult({});
    const t = setTimeout(() => {
      setResult(
        outcome === "success"
          ? { data: ["checkout-redesign", "pricing-page", "onboarding-v2"] }
          : { error: new Error("Could not load experiments.") },
      );
    }, 1200);
    return () => clearTimeout(t);
  }, [outcome]);
  useEffect(load, [load]);
  return { ...result, reload: load };
}

function Section({ outcome }: { outcome: Outcome }) {
  const { data, error, reload } = useFakeApi(outcome);

  if (error) {
    return <Callout status="error">{error.message}</Callout>;
  }
  if (!data) {
    return (
      <Box position="relative" style={{ minHeight: 80 }}>
        <LoadingOverlay relativePosition />
      </Box>
    );
  }
  return (
    <Flex direction="column" gap="2" align="start">
      {data.map((d) => (
        <Text key={d}>{d}</Text>
      ))}
      <Button variant="ghost" onClick={() => reload()}>
        Reload
      </Button>
    </Flex>
  );
}

export default function LoadingAndErrorsStory() {
  const [outcome, setOutcome] = useState<Outcome>("success");
  const [key, setKey] = useState(0);

  return (
    <Flex direction="column" gap="4">
      <Flex gap="3">
        <Button
          variant={outcome === "success" ? "solid" : "outline"}
          onClick={() => {
            setOutcome("success");
            setKey((k) => k + 1);
          }}
        >
          Load successfully
        </Button>
        <Button
          variant={outcome === "error" ? "solid" : "outline"}
          onClick={() => {
            setOutcome("error");
            setKey((k) => k + 1);
          }}
        >
          Load with an error
        </Button>
      </Flex>
      <Section key={key} outcome={outcome} />
      <Box>
        <Text weight="semibold">Inline error with details</Text>
        <ErrorDisplay
          mt="2"
          error="The query failed to run."
          details={"SyntaxError: unexpected token at line 3\n  at runQuery"}
        />
      </Box>
    </Flex>
  );
}
