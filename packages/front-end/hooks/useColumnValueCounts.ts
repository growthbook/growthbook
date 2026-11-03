import { useRef, useState } from "react";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";

export type ValueCount = { value: string; count: number };

/**
 * Row counts per value, loaded on demand and kept in page memory only. Each
 * load runs the column's top-values query on the warehouse, which also
 * refreshes the stored top values, so definitions are reloaded after.
 */
export default function useColumnValueCounts(factTableId: string) {
  const { apiCall } = useAuth();
  const { mutateDefinitions } = useDefinitions();
  const [counts, setCounts] = useState<Record<string, ValueCount[]>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Effects can call load twice before loading state lands (Strict Mode)
  const inflight = useRef(new Set<string>());

  async function load(column: string) {
    if (inflight.current.has(column)) return;
    inflight.current.add(column);
    setLoading((l) => ({ ...l, [column]: true }));
    setErrors((e) => ({ ...e, [column]: "" }));
    try {
      const res = await apiCall<{ values: ValueCount[] }>(
        `/fact-tables/${factTableId}/column/${encodeURIComponent(column)}/top-values`,
        { method: "POST" },
      );
      setCounts((c) => ({ ...c, [column]: res.values }));
      await mutateDefinitions();
    } catch (e) {
      setErrors((err) => ({
        ...err,
        [column]: e instanceof Error ? e.message : String(e),
      }));
    } finally {
      inflight.current.delete(column);
      setLoading((l) => ({ ...l, [column]: false }));
    }
  }

  return { counts, loading, errors, load };
}
