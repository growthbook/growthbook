import { formatAIRateLimitRetryMessage } from "shared/ai";
import { FactMetricInterface } from "shared/types/fact-table";
import MarkdownInlineEdit from "@/components/Markdown/MarkdownInlineEdit";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import Text from "@/ui/Text";

export default function MetricDescription({
  metric,
}: {
  metric: FactMetricInterface;
}) {
  const { apiCall } = useAuth();
  const { mutateDefinitions } = useDefinitions();
  const permissions = usePermissionsUtil();
  const canEdit =
    !["api", "config"].includes(metric.managedBy || "") &&
    permissions.canUpdateFactMetric(metric, {});

  return (
    <MarkdownInlineEdit
      header={<Text weight="semibold">Description</Text>}
      headerClassName=""
      label="description"
      value={metric.description || ""}
      canCreate={canEdit}
      canEdit={canEdit}
      emptyHelperText="Add a description to keep your team informed about how to apply this metric."
      save={async (description) => {
        await apiCall(`/fact-metrics/${metric.id}`, {
          method: "PUT",
          body: JSON.stringify({ description }),
        });
        await mutateDefinitions({});
      }}
      aiSuggestFunction={async () => {
        const res = await apiCall<{
          status: number;
          data?: { description: string };
        }>(
          `/metrics/${metric.id}/gen-description`,
          { method: "GET" },
          (response) => {
            throw new Error(
              response.status === 429
                ? formatAIRateLimitRetryMessage(response.retryAfter)
                : response.message || "Error getting AI suggestion",
            );
          },
        );
        if (res.status !== 200 || !res.data) {
          throw new Error("Could not load AI suggestions");
        }
        return res.data.description;
      }}
      aiButtonText="Suggest description"
      aiSuggestionHeader="Suggested Description"
    />
  );
}
