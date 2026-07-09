import { useCallback, useRef, useState } from "react";
import { useAuth } from "@/services/auth";

export interface UseFeatureDependencyIndexReturn {
  dependencyIndex: Set<string> | null;
  fetch: () => Promise<void>;
  loading: boolean;
}

export function useFeatureDependencyIndex(): UseFeatureDependencyIndexReturn {
  const { apiCall } = useAuth();
  const [dependencyIndex, setDependencyIndex] = useState<Set<string> | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const hasFetched = useRef(false);
  const inflightRef = useRef(false);

  const fetchIndex = useCallback(async () => {
    if (hasFetched.current || inflightRef.current) return;
    inflightRef.current = true;
    setLoading(true);
    try {
      const res = await apiCall<{ prerequisiteFeatureIds: string[] }>(
        "/features/dependency-index",
      );
      setDependencyIndex(new Set(res.prerequisiteFeatureIds ?? []));
      hasFetched.current = true;
    } catch {
      // leave dependencyIndex null so the filter can retry on next activation
    } finally {
      setLoading(false);
      inflightRef.current = false;
    }
  }, [apiCall]);

  return { dependencyIndex, fetch: fetchIndex, loading };
}
