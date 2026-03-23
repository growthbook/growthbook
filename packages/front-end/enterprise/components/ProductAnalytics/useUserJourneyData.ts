import { useState, useCallback } from "react";
import type { UserJourney, UserJourneyConfig } from "shared/validators";
import type { QueryInterface } from "shared/types/query";
import { useAuth } from "@/services/auth";
import { CacheOption } from "./useExploreData";

export function useUserJourneyData() {
  const { apiCall } = useAuth();
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(
    async (
      config: UserJourneyConfig,
      options?: { cache?: CacheOption },
    ): Promise<{
      data: UserJourney | null;
      error: string | null;
      query: QueryInterface | null;
    }> => {
      const cache = options?.cache ?? "preferred";
      const silent = cache === "required";
      if (!silent) {
        setLoading(true);
      }
      try {
        const response = await apiCall<{
          userJourney: UserJourney;
          query: QueryInterface | null;
        }>(`/product-analytics/user-journey/run?cache=${cache}`, {
          method: "POST",
          body: JSON.stringify({ config }),
        });

        if (response.userJourney?.error) {
          return {
            data: response.userJourney,
            error: response.userJourney.error,
            query: response.query ?? null,
          };
        }
        return {
          data: response.userJourney,
          error: null,
          query: response.query ?? null,
        };
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        return { data: null, error: err.message, query: null };
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [apiCall],
  );

  const extendPath = useCallback(
    async ({
      id,
      config,
      pathToExtend,
      stepToExtend,
      cache = "never",
    }: {
      id: string;
      config: UserJourneyConfig;
      pathToExtend: string[];
      stepToExtend: number;
      cache?: CacheOption;
    }): Promise<{ data: UserJourney | null; error: string | null }> => {
      const silent = cache === "required";
      if (!silent) {
        setLoading(true);
      }
      try {
        const response = await apiCall<{
          userJourney: UserJourney;
        }>(`/product-analytics/user-journey/${id}/extend?cache=${cache}`, {
          method: "POST",
          body: JSON.stringify({
            config,
            pathToExtend,
            stepToExtend,
          }),
        });

        if (response.userJourney?.error) {
          return {
            data: response.userJourney,
            error: response.userJourney.error,
          };
        }
        return {
          data: response.userJourney,
          error: null,
        };
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        return { data: null, error: err.message };
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [apiCall],
  );

  return {
    loading,
    fetchData,
    extendPath,
  };
}
