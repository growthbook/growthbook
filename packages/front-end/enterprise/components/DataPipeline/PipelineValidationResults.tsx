import type { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import type {
  PipelineValidationResult,
  PipelineValidationResults,
} from "shared/enterprise";
import { Flex, Text, Blockquote } from "@radix-ui/themes";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import { capitalizeFirstLetter } from "@/services/utils";

type Props = {
  tableName?: string;
  results: PipelineValidationResults;
} & MarginProps;

export default function PipelineValidationResultsView({
  results,
  tableName,
}: Props) {
  return (
    <Callout status="warning" variant="surface">
      <Flex direction="column" gap="2">
        <Text>
          We were unable to validate the current settings using a{" "}
          <abbr title={tableName}>temporary test table</abbr>.
        </Text>

        <Flex direction="column" mt="1" gap="3">
          <ResultStepSummary title="Create table" result={results.create} />
          {results.insert && (
            <ResultStepSummary title="Insert data" result={results.insert} />
          )}
          {results.drop && (
            <ResultStepSummary title="Drop table" result={results.drop} />
          )}
        </Flex>
      </Flex>
    </Callout>
  );
}

function ResultStepSummary({
  title,
  result,
}: {
  title: string;
  result: PipelineValidationResult;
}) {
  const status = getResultStatus(result.result);
  const color = getResultColor(result.result);

  return (
    <Flex direction="column" gap="2">
      <HelperText status={status}>
        {title}: {capitalizeFirstLetter(result.result)}
      </HelperText>
      {result.resultMessage ? (
        <Blockquote mb="0" color={color}>
          {result.resultMessage}
        </Blockquote>
      ) : null}
    </Flex>
  );
}

function getResultStatus(result: PipelineValidationResult["result"]) {
  switch (result) {
    case "success":
      return "success" as const;
    case "skipped":
      return "info" as const;
    case "failed":
      return "error" as const;
    default: {
      const _exhaustive: never = result as never;
      return _exhaustive;
    }
  }
}

function getResultColor(result: PipelineValidationResult["result"]) {
  switch (result) {
    case "success":
      return "green" as const;
    case "skipped":
      return "violet" as const;
    case "failed":
      return "red" as const;
    default: {
      const _exhaustive: never = result as never;
      return _exhaustive;
    }
  }
}
