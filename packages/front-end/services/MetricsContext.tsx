import { createContext, FC, useContext, useEffect } from "react";
import { MetricInterface, MetricType } from "back-end/types/metric";
import useApi from "../hooks/useApi";
import { useAuth } from "./auth";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});
const currencyFormatter = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
});

export function getMetricConversionTitle(type: MetricType): string {
  // TODO: support more metric types
  if (type === "count") {
    return "Count per User";
  }
  if (type === "duration") {
    return "Duration";
  }
  if (type === "revenue") {
    return "Revenue";
  }
  return "Conversion Rate";
}
export function formatConversionRate(type: MetricType, value: number): string {
  value = value || 0;
  if (type === "count") {
    return value.toFixed(2);
  }
  if (type === "duration") {
    // milliseconds
    if (value < 1) {
      return Math.round(value * 1000) + "ms";
    }
    // seconds
    if (value < 60) {
      return Math.round(value * 1000) / 1000 + "s";
    }

    // time string (00:00.00)
    const trimmed = Math.round(value * 10) / 10;
    const dec = (Math.round((trimmed % 1) * 10) + "").replace(/0$/, "");
    const s = "" + (Math.floor(trimmed) % 60);
    const m = "" + (Math.floor(trimmed / 60) % 60);
    const h = "" + (Math.floor(trimmed / 3600) % 24);
    const d = Math.floor(trimmed / (3600 * 24));

    const f =
      (d > 0 ? d + " days " : "") +
      (trimmed > 1800 ? h.padStart(2, "0") + ":" : "") +
      m.padStart(2, "0") +
      ":" +
      s.padStart(2, "0") +
      (trimmed < 300 && dec ? "." + dec : "");

    return f;
  }
  if (type === "revenue") {
    return currencyFormatter.format(value);
  }

  return percentFormatter.format(value);
}

export type MetricsContextValue = {
  ready: boolean;
  error?: Error;
  refresh: () => void;
  getDisplayName: (id: string) => string;
  getMetricType: (id: string) => MetricType;
  getMetricDatasource: (id: string) => string;
  isInverse: (id: string) => boolean;
  metrics: Partial<MetricInterface>[];
};

const MetricsContext = createContext<MetricsContextValue>({
  ready: false,
  error: undefined,
  refresh: () => {
    /* */
  },
  getDisplayName: () => "",
  getMetricType: () => "binomial",
  isInverse: () => false,
  getMetricDatasource: () => null,
  metrics: [],
});

export default MetricsContext;

export const useMetrics = (): MetricsContextValue => {
  return useContext(MetricsContext);
};

export const MetricsProvider: FC = ({ children }) => {
  const { data, error, mutate } = useApi<{
    metrics: Partial<MetricInterface>[];
  }>(`/metrics`);

  const { orgId } = useAuth();
  useEffect(() => {
    if (orgId) {
      mutate();
    }
  }, [orgId]);

  const getDisplayName = (id: string) => {
    if (data) {
      // TODO: cache this lookup once instead of looping each time
      return data.metrics.filter((d) => d.id === id)[0]?.name || id;
    }
    return id;
  };

  const getMetricType = (id: string) => {
    if (data) {
      // TODO: cache this lookup once instead of looping each time
      return data.metrics.filter((d) => d.id === id)[0]?.type || "binomial";
    }
    return "binomial";
  };
  const getMetricDatasource = (id: string) => {
    if (data) {
      // TODO: cache this lookup once instead of looping each time
      return data.metrics.filter((d) => d.id === id)[0]?.datasource || null;
    }
    return "binomial";
  };
  const isInverse = (id: string) => {
    if (data) {
      // TODO: cache this lookup once instead of looping each time
      return data.metrics.filter((d) => d.id === id)[0]?.inverse || false;
    }
    return false;
  };

  return (
    <MetricsContext.Provider
      value={{
        ready: data ? true : false,
        error: error,
        getDisplayName,
        refresh: mutate,
        isInverse,
        metrics: data ? data.metrics : [],
        getMetricType,
        getMetricDatasource,
      }}
    >
      {children}
    </MetricsContext.Provider>
  );
};
