import { describe, it, expect } from "vitest";
import {
  timeoutError,
  timeoutSecondsFromInput,
} from "@/components/EventWebHooks/utils";

describe("webhook timeout form helpers", () => {
  it("maps a blank input to null so an edit clears the stored value", () => {
    expect(timeoutSecondsFromInput("")).toBeNull();
    expect(timeoutSecondsFromInput(null)).toBeNull();
    expect(timeoutSecondsFromInput(undefined)).toBeNull();
    expect(timeoutSecondsFromInput("45")).toBe(45);
    expect(timeoutSecondsFromInput("0")).toBe(0);
  });

  it("accepts blank, unset, and whole seconds of at least 1", () => {
    expect(timeoutError(null)).toBeUndefined();
    expect(timeoutError(undefined)).toBeUndefined();
    expect(timeoutError(1)).toBeUndefined();
    expect(timeoutError(120)).toBeUndefined();
  });

  it("leaves the cap to the server when self-hosted", () => {
    expect(timeoutError(500)).toBeUndefined();
  });

  it("rejects zero, fractions, and non-numbers", () => {
    expect(timeoutError(0)).toBeDefined();
    expect(timeoutError(1.5)).toBeDefined();
    expect(timeoutError(NaN)).toBeDefined();
  });
});
