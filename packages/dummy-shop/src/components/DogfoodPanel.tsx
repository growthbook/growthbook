import { useEffect, useState } from "react";
import { useFeatureIsOn, useFeatureValue } from "@growthbook/growthbook-react";
import {
  clearEvents,
  getEvents,
  subscribe,
  type AnalyticsEvent,
} from "../lib/analytics";
import { CHECKOUT_DEFAULT, CTA_DEFAULT, FLAGS } from "../lib/flags";
import { growthbookConfig } from "../lib/growthbook";

export function DogfoodPanel() {
  const [collapsed, setCollapsed] = useState(false);
  const [events, setEvents] = useState<AnalyticsEvent[]>(() => getEvents());

  const promo = useFeatureIsOn(FLAGS.promoBanner);
  const cta = useFeatureValue(FLAGS.ctaCopy, CTA_DEFAULT);
  const shipping = useFeatureIsOn(FLAGS.freeShippingBadge);
  const checkout = useFeatureValue(FLAGS.checkoutFlow, CHECKOUT_DEFAULT);

  useEffect(() => subscribe(setEvents), []);

  return (
    <aside className={`dogfood-panel${collapsed ? " collapsed" : ""}`}>
      <header>
        <span>Dogfood panel</span>
        <button type="button" onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? "Open" : "Hide"}
        </button>
      </header>
      <div className="dogfood-body">
        <div>
          SDK:{" "}
          <span
            className={`status-pill ${growthbookConfig.hasClientKey ? "ok" : "warn"}`}
          >
            {growthbookConfig.hasClientKey
              ? `connected · ${growthbookConfig.apiHost}`
              : "offline defaults"}
          </span>
        </div>

        <h3>Live flags</h3>
        <ul>
          <li className="flag-row">
            <code>{FLAGS.promoBanner}</code>
            <span>{promo ? "on" : "off"}</span>
          </li>
          <li className="flag-row">
            <code>{FLAGS.ctaCopy}</code>
            <span>{String(cta)}</span>
          </li>
          <li className="flag-row">
            <code>{FLAGS.freeShippingBadge}</code>
            <span>{shipping ? "on" : "off"}</span>
          </li>
          <li className="flag-row">
            <code>{FLAGS.checkoutFlow}</code>
            <span>{String(checkout)}</span>
          </li>
        </ul>

        <h3>
          Events{" "}
          <button type="button" onClick={clearEvents}>
            Clear
          </button>
        </h3>
        <ul>
          {events.length === 0 ? (
            <li className="muted">No events yet</li>
          ) : (
            events.slice(0, 12).map((event, i) => (
              <li key={`${event.timestamp}-${i}`}>
                <strong>{event.name}</strong>
                {event.properties ? (
                  <div className="muted">
                    {JSON.stringify(event.properties)}
                  </div>
                ) : null}
              </li>
            ))
          )}
        </ul>
      </div>
    </aside>
  );
}
