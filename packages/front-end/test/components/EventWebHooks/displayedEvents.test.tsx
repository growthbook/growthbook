import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { displayedEvents } from "@/components/EventWebHooks/utils";

const text = (events: string[], max?: number) =>
  renderToStaticMarkup(
    <>{displayedEvents(events, { maxEventsDisplay: max })}</>,
  ).replace(/<[^>]+>/g, "");

describe("displayedEvents", () => {
  it("lists every event when under the cap", () => {
    expect(text(["a", "b"], 5)).toBe("a, b");
    expect(text(["a", "b", "c"])).toBe("a, b, c");
  });

  it("cuts off at the cap and counts the rest", () => {
    expect(text(["a", "b", "c", "d", "e", "f", "g"], 5)).toBe(
      "a, b, c, d, e and 2 more",
    );
  });
});
