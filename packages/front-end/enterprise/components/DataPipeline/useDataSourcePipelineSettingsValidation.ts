import { useCallback, useState } from "react";
import type { PipelineValidationResults } from "shared/enterprise";
import type { DataSourcePipelineSettings } from "back-end/types/datasource";
import { useAuth } from "@/services/auth";

type ValidateArgs = {
  datasourceId: string;
  pipelineSettings: DataSourcePipelineSettings;
};

export function useDataSourcePipelineSettingsValidation() {
  const { apiCall } = useAuth();

  const [error, setError] = useState<string>();
  const [tableName, setTableName] = useState<string>();
  const [results, setResults] = useState<PipelineValidationResults>();

  const validate = useCallback(
    async ({
      datasourceId,
      pipelineSettings,
    }: ValidateArgs): Promise<boolean> => {
      setError(undefined);
      setTableName(undefined);
      setResults(undefined);

      try {
        const res = await apiCall<
          | { message: string }
          | { tableName?: string; results: PipelineValidationResults }
        >(`/datasource/${datasourceId}/pipeline/validate`, {
          method: "POST",
          body: JSON.stringify({
            pipelineSettings,
          }),
        });

        if ("message" in res) {
          setError(res.message);
          return false;
        }

        const { tableName: requestTableName, results: validationResults } = res;
        setTableName(requestTableName);
        setResults(validationResults);

        const allSuccesses = Object.values(validationResults).every(
          (result) => result.result === "success",
        );

        return allSuccesses;
      } catch (e) {
        setError(
          "message" in e
            ? e.message
            : String(e) || "Failed to validate permissions",
        );
        return false;
      }
    },
    [apiCall],
  );

  return {
    validate,
    validationError: error,
    validationResults: results,
    validationTableName: tableName,
  };
}
