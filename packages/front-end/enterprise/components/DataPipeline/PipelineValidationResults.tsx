import type { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import type {
  PipelineValidationResult,
  PipelineValidationResults,
} from "shared/enterprise";
import { Flex, Blockquote, Box } from "@radix-ui/themes";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import HelperText from "@/ui/HelperText";
import { capitalizeFirstLetter } from "@/services/utils";

type Props = {
  validationError: string | undefined;
  tableName?: string;
  results: PipelineValidationResults;
} & MarginProps;

export default function PipelineValidationResultsView({
  validationError,
  results,
  tableName,
}: Props) {
  return (
    <Box>
      <Callout status="warning" mb="3">
        <Text>
          We were unable to validate the current settings using a temporary test
          table{tableName ? ` (${tableName})` : ""}.
          {validationError ? (
            <>
              <br />
              <br />
              {validationError}
            </>
          ) : null}
        </Text>
      </Callout>
      <Flex direction="column" ml="4" gap="2">
        <Flex direction="column" mt="1" gap="4">
          <ResultStepSummary title="Create table" result={results.create} />
          {results.insert && (
            <ResultStepSummary title="Insert data" result={results.insert} />
          )}
          {results.drop && (
            <ResultStepSummary title="Drop table" result={results.drop} />
          )}
        </Flex>
      </Flex>
    </Box>
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

  return (
    <Flex direction="column" gap="2">
      <HelperText status={status}>
        {title}: {capitalizeFirstLetter(result.result)}
      </HelperText>
      {result.resultMessage ? (
        <Blockquote ml="1" mb="0">
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
