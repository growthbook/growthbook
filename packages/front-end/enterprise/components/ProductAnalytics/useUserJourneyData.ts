import { useState, useCallback } from "react";
import type { UserJourney, UserJourneyConfig } from "shared/validators";
import { useAuth } from "@/services/auth";

export function useUserJourneyData() {
  const { apiCall } = useAuth();
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(
    async (
      config: UserJourneyConfig,
    ): Promise<{ data: UserJourney | null; error: string | null }> => {
      setLoading(true);
      try {
        const response = await apiCall<{
          userJourney: UserJourney;
          //MKTODO: Update this so the cache isn't hard-coded
        }>("/product-analytics/user-journey/run?cache=never", {
          method: "POST",
          body: JSON.stringify({ config }),
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
        setLoading(false);
      }
    },
    [apiCall],
  );

  return {
    loading,
    fetchData,
  };
}
