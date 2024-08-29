/* eslint-disable @typescript-eslint/no-explicit-any */

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/services/auth";
import {useDefinitions} from "@/services/DefinitionsContext";
import cloneDeep from "lodash/cloneDeep";

interface AskAnythingContextType {
  queryContext: any | null;
  setQueryContext: (context: any | null) => void;
  queryResult: any | null;
  submitQuery: (query: string) => Promise<any>;
  history: {user: string; value: string;}[];
  setHistory: (history: {user: string; value: string;}[]) => void;
  loading: boolean;
  error: string;
  setError: (error: string) => void;
}

const AskAnythingContext = createContext<AskAnythingContextType | undefined>(undefined);

export const AskAnythingProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { apiCall } = useAuth();
  const { metrics } = useDefinitions();
  const path = usePathname();

  const [queryResult, setQueryResult] = useState<any | null>(null);
  const [queryContext, setQueryContext] = useState<any | null>(null);
  const [history, setHistory] = useState<{user: string; value: string;}[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [currentPath, setCurrentPath] = useState(path);

  async function submitQuery(query: string) {
    setQueryResult(null);
    setLoading(true);
    setError("");
    let context = cloneDeep(queryContext);
    if (!queryContext?.noHtml) {
      context = {
        ...context,
        pageHtml: document.querySelector("main")?.innerHTML
      };
      delete context.noHtml;

      setQueryContext(context);
    }
    await apiCall<{ result: any }>(`/ask-anything/`, {
      method: "POST",
      body: JSON.stringify({
        query,
        history,
        queryContext: (typeof queryContext !== "object" ? { context } : context) ?? undefined,
        path: currentPath,
      }),
    })
      .then((data) => {
        setLoading(false);
        setQueryResult(data.result);
        setHistory([...history, ...[
          { user: "user", value: query },
          { user: "agent", value: data.result },
        ]]);
      })
      .catch((e) => {
        setLoading(false);
        setError(e?.message || "Unknown error");
        console.error(e);
      });
  }

  // Effect to clear context on path change
  useEffect(() => {
    if (path !== currentPath) {
      setCurrentPath(path);
      setQueryContext(null);
      setHistory([]);
    }
  }, [path, currentPath]);

  useEffect(() => {
    setQueryContext({
      ...queryContext,
      metrics,
    })
  }, [metrics]);

  return (
    <AskAnythingContext.Provider
      value={{ queryContext, setQueryContext, queryResult, submitQuery, history, setHistory, loading, error, setError }}
    >
      {children}
    </AskAnythingContext.Provider>
  );
};

export function useAskAnything(): AskAnythingContextType {
  const context = useContext(AskAnythingContext);
  if (!context) {
    throw new Error("useAskAnything must be used within an AskAnythingProvider");
  }
  return context;
}
