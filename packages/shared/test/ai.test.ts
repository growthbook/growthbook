import { formatAIRateLimitRetryMessage } from "../src/ai";

describe("formatAIRateLimitRetryMessage", () => {
  it("formats duration with singular units when appropriate", () => {
    expect(formatAIRateLimitRetryMessage(3661)).toBe(
      "You have reached the AI request limit. Try again in 1 hour and 1 minute.",
    );
    expect(formatAIRateLimitRetryMessage("3600")).toBe(
      "You have reached the AI request limit. Try again in 1 hour.",
    );
    expect(formatAIRateLimitRetryMessage(7200)).toBe(
      "You have reached the AI request limit. Try again in 2 hours.",
    );
    expect(formatAIRateLimitRetryMessage(120)).toBe(
      "You have reached the AI request limit. Try again in 2 minutes.",
    );
  });

  it("uses sub-minute copy when under one minute", () => {
    expect(formatAIRateLimitRetryMessage(45)).toBe(
      "You have reached the AI request limit. Try again in less than a minute.",
    );
  });

  it("returns generic copy when missing or invalid", () => {
    expect(formatAIRateLimitRetryMessage(undefined)).toContain(
      "Please try again later",
    );
    expect(formatAIRateLimitRetryMessage("x")).toContain(
      "Please try again later",
    );
  });
});
