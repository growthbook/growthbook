import { Flex } from "@radix-ui/themes";
import { StoryMeta } from "@/ui/storyMeta";
import ErrorDisplay from "./ErrorDisplay";

export const meta: StoryMeta = {
  name: "ErrorDisplay",
  category: "feedback",
  status: "stable",
  summary:
    "A red block that shows an error message with optional scrollable details.",
  useWhen: [
    "Show a query or SQL error with its raw details.",
    "Show long error text that needs a capped, scrollable height.",
  ],
  avoidWhen: [
    {
      reason: "A short status or validation message is enough.",
      use: "Callout",
    },
  ],
  related: ["Callout"],
};

export default function ErrorDisplayStories() {
  return (
    <Flex direction="column" gap="3" maxWidth="600px">
      <ErrorDisplay error="Unable to connect to the Data Source." />
      <ErrorDisplay
        error="Query failed: column `user_id` does not exist."
        details={`Error: column "user_id" does not exist\n  at Query.run (query.ts:42)\n  at Runner.execute (runner.ts:118)`}
      />
    </Flex>
  );
}
