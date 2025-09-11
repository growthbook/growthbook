import type { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import type {
  PipelineValidationResult,
  PipelineValidationResults,
} from "shared/enterprise";
import { Flex, Text, Blockquote } from "@radix-ui/themes";
import Callout from "@/components/Radix/Callout";
import HelperText from "@/components/Radix/HelperText";
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
        <Text>Validation failed.</Text>

        <Text>
          We attempted to create a <abbr title={tableName}>test table</abbr>,
          insert a row, then drop the table and we were unable to do so.
        </Text>

        <Flex direction="column" mt="1" gap="3">
          <ResultStepSummary title="Create table" result={results.create} />
          <ResultStepSummary title="Insert row" result={results.insert} />
          <ResultStepSummary title="Drop table" result={results.drop} />
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
