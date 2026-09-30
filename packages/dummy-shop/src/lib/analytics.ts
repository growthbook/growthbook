export type AnalyticsEvent = {
  name: string;
  properties?: Record<string, unknown>;
  timestamp: string;
};

type Listener = (events: AnalyticsEvent[]) => void;

const STORAGE_KEY = "cedar-market-analytics";
const MAX_EVENTS = 80;

let events: AnalyticsEvent[] = load();
const listeners = new Set<Listener>();

function load(): AnalyticsEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as AnalyticsEvent[];
  } catch {
    return [];
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch {
    // ignore quota / private mode
  }
  for (const listener of listeners) {
    listener(events);
  }
}

/** Emit a product-analytics event for GrowthBook dogfooding practice. */
export function track(
  name: string,
  properties?: Record<string, unknown>,
): void {
  const event: AnalyticsEvent = {
    name,
    properties,
    timestamp: new Date().toISOString(),
  };
  events = [event, ...events].slice(0, MAX_EVENTS);
  // Visible in DevTools; also mirrored into the on-page dogfood panel.
  console.info("[analytics]", name, properties ?? {});
  persist();
}

export function getEvents(): AnalyticsEvent[] {
  return events;
}

export function clearEvents(): void {
  events = [];
  persist();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const EVENT_NAMES = {
  viewedHome: "Viewed Home",
  viewedProduct: "Viewed Product",
  addedToCart: "Added to Cart",
  viewedCart: "Viewed Cart",
  startedCheckout: "Started Checkout",
  purchased: "Purchased",
  experimentViewed: "Experiment Viewed",
} as const;
