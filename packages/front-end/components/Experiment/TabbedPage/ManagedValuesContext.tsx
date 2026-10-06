import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { useEnvironments } from "@/services/features";

// Prototype-only, front-end-only state for experiment delivery types and the
// "managed values" the Values type carries. Nothing here round-trips to the
// API: it all lives in localStorage, keyed by experiment id. No MongoDB
// writes, no schema changes.
//
// Ported from prototype/managed-values-simplified, DELIVERY-TYPE PIECES ONLY.
// That branch's version of this file also carries the approvals layer
// (approval requests, review settings, gated environments, publish). Approvals
// are out of scope for this phase and were deliberately left behind.

// --- Managed values (the Values type's per-variation payload) -------------

export type ManagedValueDataType = "string" | "number" | "boolean" | "json";

export const DATA_TYPE_LABELS: Record<ManagedValueDataType, string> = {
  string: "String",
  number: "Number",
  boolean: "Boolean",
  json: "Parameters",
};

export interface ManagedValuesConfig {
  dataType: ManagedValueDataType;
  key: string;
  // Keyed by variation id.
  valuesByVariationId: Record<string, string>;
}

interface ManagedValuesContextValue {
  config: ManagedValuesConfig | null;
  setConfig: (config: ManagedValuesConfig | null) => void;
}

const ManagedValuesContext = createContext<ManagedValuesContextValue | null>(
  null,
);

// A minimal shape check on read guards against a hand-edited or stale value
// crashing the app; nothing but this file ever writes this key.
function isPlausibleManagedValuesConfig(
  value: unknown,
): value is ManagedValuesConfig {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as ManagedValuesConfig).dataType === "string" &&
    typeof (value as ManagedValuesConfig).valuesByVariationId === "object"
  );
}

// Exported for "Set up with AI" in Create Experiment, which writes the
// values a spec states before the experiment's page exists.
export function storeManagedValuesConfig(
  experimentId: string,
  config: ManagedValuesConfig | null,
): void {
  try {
    const key = `gb-prototype-managed-values:${experimentId}`;
    if (config === null) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(config));
  } catch {
    // Prototype-only convenience — fine to no-op if storage is unavailable.
  }
}

// Keeps only the fields this port knows about. A config written by the
// managed-values branches may also carry approval fields in the same key;
// those are dropped on read rather than carried along unused.
function readManagedValuesConfig(
  experimentId: string,
): ManagedValuesConfig | null {
  try {
    const raw = window.localStorage.getItem(
      `gb-prototype-managed-values:${experimentId}`,
    );
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isPlausibleManagedValuesConfig(parsed)) return null;
    return {
      dataType: parsed.dataType,
      key: typeof parsed.key === "string" ? parsed.key : "",
      valuesByVariationId: parsed.valuesByVariationId,
    };
  } catch {
    return null;
  }
}

export function ManagedValuesProvider({
  experimentId,
  children,
}: {
  experimentId: string;
  children: ReactNode;
}) {
  const [config, setConfigState] = useState<ManagedValuesConfig | null>(() =>
    readManagedValuesConfig(experimentId),
  );

  // Re-read if the experiment id itself changes (e.g. client-side nav
  // between two experiment pages without a full remount).
  useEffect(() => {
    setConfigState(readManagedValuesConfig(experimentId));
  }, [experimentId]);

  const setConfig = (next: ManagedValuesConfig | null) => {
    setConfigState(next);
    storeManagedValuesConfig(experimentId, next);
  };

  return (
    <ManagedValuesContext.Provider value={{ config, setConfig }}>
      {children}
    </ManagedValuesContext.Provider>
  );
}

export function useManagedValues(): ManagedValuesContextValue {
  const ctx = useContext(ManagedValuesContext);
  if (!ctx) {
    throw new Error(
      "useManagedValues must be used within a ManagedValuesProvider",
    );
  }
  return ctx;
}

// Non-throwing counterpart, for components shared with pages that don't
// mount ManagedValuesProvider (bandits, holdouts).
export function useManagedValuesConfigOptional(): ManagedValuesConfig | null {
  const ctx = useContext(ManagedValuesContext);
  return ctx?.config ?? null;
}

// One variation's value, or undefined when unset. Approvals-free: the source
// branch resolves this through the approval state (current vs proposed);
// without approvals there's only the one value.
export function formatManagedValueForVariation(
  config: ManagedValuesConfig | null,
  variationId: string,
): string | undefined {
  if (!config) return undefined;
  const value = config.valuesByVariationId[variationId];
  return value === undefined || value === "" ? undefined : value;
}

// Deterministic, dependency-free slug — good enough for a design prototype;
// production would reuse whatever key-generation the real feature flag
// creation flow already has.
export function slugifyManagedValueKey(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "managed_value";
}

// --- Delivery method -------------------------------------------------------
//
// The type chosen in the create-experiment modal (or changed later via
// ChangeExperimentTypeModal) is the single source of truth for which surface
// a variation's changes reach users through. It drives the variation cards'
// payload row, the Edit Traffic & Variations modal's column, and which linked
// changes the Setup page shows.

export type DeliveryMethod =
  | "values"
  | "feature-flag"
  | "visual-editor"
  | "url-redirect";

export const DELIVERY_METHOD_LABELS: Record<DeliveryMethod, string> = {
  values: "Values",
  "feature-flag": "Feature Flag",
  "visual-editor": "Visual Editor",
  "url-redirect": "URL Redirect",
};

// Exported (unlike the other store* helpers) because the create-experiment
// form writes it once, right after creation — before an
// ExperimentTypeProvider for that new experiment id exists.
export function storeExperimentDeliveryType(
  experimentId: string,
  type: DeliveryMethod,
): void {
  try {
    window.localStorage.setItem(
      `gb-prototype-delivery-type:${experimentId}`,
      type,
    );
  } catch {
    // Prototype-only convenience — fine to no-op if storage is unavailable.
  }
}

function readExperimentDeliveryType(experimentId: string): DeliveryMethod {
  try {
    const value = window.localStorage.getItem(
      `gb-prototype-delivery-type:${experimentId}`,
    );
    return value !== null && value in DELIVERY_METHOD_LABELS
      ? (value as DeliveryMethod)
      : "values";
  } catch {
    return "values";
  }
}

function storeExperimentVisualEditorUrl(
  experimentId: string,
  url: string,
): void {
  try {
    window.localStorage.setItem(
      `gb-prototype-visual-editor-url:${experimentId}`,
      url,
    );
  } catch {
    // Prototype-only convenience — fine to no-op if storage is unavailable.
  }
}

function readExperimentVisualEditorUrl(experimentId: string): string {
  try {
    return (
      window.localStorage.getItem(
        `gb-prototype-visual-editor-url:${experimentId}`,
      ) ?? ""
    );
  } catch {
    return "";
  }
}

// The URL Redirect type's Original URL — needed by the Edit Traffic modal's
// context field and by each row's destination input.
function storeExperimentRedirectOriginUrl(
  experimentId: string,
  url: string,
): void {
  try {
    window.localStorage.setItem(
      `gb-prototype-redirect-origin-url:${experimentId}`,
      url,
    );
  } catch {
    // Prototype-only convenience — fine to no-op if storage is unavailable.
  }
}

function readExperimentRedirectOriginUrl(experimentId: string): string {
  try {
    return (
      window.localStorage.getItem(
        `gb-prototype-redirect-origin-url:${experimentId}`,
      ) ?? ""
    );
  } catch {
    return "";
  }
}

// Environments a VALUES experiment delivers to. Only that type has this
// field: experiments have no environments field in the real model — the page's
// `envs` is derived from linked features' rules, and a Values experiment has
// no linked feature, so there's nothing to derive from.
//
// Ported without the source branch's approval coupling: no gated
// environments, no review requirement, no publishing out of a request. Just
// the stored selection.
//
// Nothing stored (a new experiment, or one never edited) means EVERY
// environment, as set in review: a new experiment starts enabled in all of
// them. The provider fills that in from the org's environments, so it
// follows them as they change until someone saves a choice. A saved empty
// list (only possible before at least one became required) reads as
// nothing stored too. Unparseable data falls back the same way.
function storeExperimentEnvironments(
  experimentId: string,
  environments: string[],
): void {
  try {
    window.localStorage.setItem(
      `gb-prototype-environments:${experimentId}`,
      JSON.stringify(environments),
    );
  } catch {
    // Prototype-only convenience — fine to no-op if storage is unavailable.
  }
}

// Null: nothing stored, so every environment (see above).
function readExperimentEnvironments(experimentId: string): string[] | null {
  try {
    const raw = window.localStorage.getItem(
      `gb-prototype-environments:${experimentId}`,
    );
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const list = Array.isArray(parsed)
      ? parsed.filter((e): e is string => typeof e === "string")
      : [];
    return list.length ? list : null;
  } catch {
    return null;
  }
}

// --- Reactive context ------------------------------------------------------
//
// A Context rather than a plain function because changing the type in one
// place has to re-render every consumer (the Setup page, the modals, the
// variation cards) without a page reload. Mounted once per experiment id at
// the page level (see pages/experiment/[eid].tsx).
interface ExperimentTypeContextValue {
  type: DeliveryMethod;
  setType: (type: DeliveryMethod) => void;
  visualEditorUrl: string;
  setVisualEditorUrl: (url: string) => void;
  redirectOriginUrl: string;
  setRedirectOriginUrl: (url: string) => void;
  // Values type only; see storeExperimentEnvironments.
  environments: string[];
  setEnvironments: (environments: string[]) => void;
}

const ExperimentTypeContext = createContext<ExperimentTypeContextValue | null>(
  null,
);

export function ExperimentTypeProvider({
  experimentId,
  children,
}: {
  experimentId: string;
  children: ReactNode;
}) {
  const [type, setTypeState] = useState<DeliveryMethod>(() =>
    readExperimentDeliveryType(experimentId),
  );
  const [visualEditorUrl, setVisualEditorUrlState] = useState<string>(() =>
    readExperimentVisualEditorUrl(experimentId),
  );
  const [redirectOriginUrl, setRedirectOriginUrlState] = useState<string>(() =>
    readExperimentRedirectOriginUrl(experimentId),
  );
  const [storedEnvironments, setEnvironmentsState] = useState<string[] | null>(
    () => readExperimentEnvironments(experimentId),
  );
  // Nothing stored: all of the org's environments.
  const allEnvironments = useEnvironments();
  const environments =
    storedEnvironments ?? allEnvironments.map((env) => env.id);

  // Re-read if the experiment id itself changes (e.g. client-side nav
  // between two experiment pages without a full remount).
  useEffect(() => {
    setTypeState(readExperimentDeliveryType(experimentId));
    setVisualEditorUrlState(readExperimentVisualEditorUrl(experimentId));
    setRedirectOriginUrlState(readExperimentRedirectOriginUrl(experimentId));
    setEnvironmentsState(readExperimentEnvironments(experimentId));
  }, [experimentId]);

  const setType = (t: DeliveryMethod) => {
    setTypeState(t);
    storeExperimentDeliveryType(experimentId, t);
  };
  const setVisualEditorUrl = (url: string) => {
    setVisualEditorUrlState(url);
    storeExperimentVisualEditorUrl(experimentId, url);
  };
  const setRedirectOriginUrl = (url: string) => {
    setRedirectOriginUrlState(url);
    storeExperimentRedirectOriginUrl(experimentId, url);
  };
  const setEnvironments = (next: string[]) => {
    setEnvironmentsState(next);
    storeExperimentEnvironments(experimentId, next);
  };

  return (
    <ExperimentTypeContext.Provider
      value={{
        type,
        setType,
        visualEditorUrl,
        setVisualEditorUrl,
        redirectOriginUrl,
        setRedirectOriginUrl,
        environments,
        setEnvironments,
      }}
    >
      {children}
    </ExperimentTypeContext.Provider>
  );
}

export function useExperimentType(): ExperimentTypeContextValue {
  const ctx = useContext(ExperimentTypeContext);
  if (!ctx) {
    throw new Error(
      "useExperimentType must be used within an ExperimentTypeProvider",
    );
  }
  return ctx;
}

// Non-throwing counterpart for components that also render on pages without
// an ExperimentTypeProvider (pages/holdout/[hid].tsx, pages/bandit/[bid].tsx
// both reuse TabbedPage). Returns undefined when there's no provider.
export function useExperimentTypeOptional(): DeliveryMethod | undefined {
  const ctx = useContext(ExperimentTypeContext);
  return ctx?.type;
}
