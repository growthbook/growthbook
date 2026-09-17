import type { NotificationEvent } from "shared/types/events/notification-events";
import { renderNotificationCard } from "back-end/src/services/notificationCards/renderNotificationCard";
import { renderCard } from "back-end/src/services/notificationCards/cardStyles";
import type { CardSection } from "back-end/src/services/notificationCards/types";

jest.mock("back-end/src/services/notificationCards/cardStyles", () => ({
  renderCard: jest.fn(),
}));

const notification = (
  event: string,
  object: Record<string, unknown>,
): NotificationEvent =>
  ({
    event,
    data: { object },
  }) as unknown as NotificationEvent;

const srmWarning = notification("experiment.warning", {
  type: "srm",
  experimentId: "exp-1",
  experimentName: "Checkout",
  threshold: 0.001,
});

describe("renderNotificationCard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(renderCard).mockResolvedValue(Buffer.from("png"));
  });

  it("renders the SRM warning card from the event payload alone", async () => {
    await expect(renderNotificationCard(srmWarning, "light")).resolves.toEqual({
      png: Buffer.from("png"),
      altText: "Checkout - Health Alert - SRM Detected",
      objectUrl: expect.stringMatching(/^https?:\/\/.+\/experiment\/exp-1$/),
      objectName: "Checkout",
      eventLabel: "Health Alert - SRM Detected",
    });
    expect(renderCard).toHaveBeenCalledWith(
      expect.objectContaining({
        tone: "warning",
        icon: "warn",
        url: expect.stringMatching(/\/experiment\/exp-1$/),
        banner: "Health Alert - SRM Detected",
      }),
      "light",
    );
  });

  it("adds the balance table when the SRM payload carries evidence", async () => {
    await renderNotificationCard(
      notification("experiment.warning", {
        type: "srm",
        experimentId: "exp-1",
        experimentName: "Checkout",
        threshold: 0.001,
        pValue: 0.00042,
        variations: [
          { name: "Control", users: 6200, weight: 1 },
          { name: "Treatment", users: 3800, weight: 1 },
        ],
      }),
      "light",
    );
    expect(renderCard).toHaveBeenCalledWith(
      expect.objectContaining({
        sections: [
          {
            kind: "table",
            table: {
              columns: ["Variation", "Units", "Actual %", "Expected %"],
              rows: [
                ["Control", "6,200", "62%", "50%"],
                ["Treatment", "3,800", "38%", "50%"],
              ],
              note: "p-value: <0.001",
            },
          },
        ],
        footer: "10,000 units",
      }),
      "light",
    );
  });

  it.each(["light", "dark"] as const)(
    "passes the %s format through to the renderer",
    async (format) => {
      await renderNotificationCard(srmWarning, format);
      expect(renderCard).toHaveBeenCalledWith(expect.anything(), format);
    },
  );

  it.each(["no-data", "underpowered", "multiple-exposures"])(
    "leaves the %s warning as an accurate text notification",
    async (type) => {
      await expect(
        renderNotificationCard(
          notification("experiment.warning", {
            type,
            experimentId: "exp-1",
            experimentName: "Checkout",
          }),
          "light",
        ),
      ).resolves.toBeNull();
      expect(renderCard).not.toHaveBeenCalled();
    },
  );

  it("renders the started card with a banner and labeled fields", async () => {
    await expect(
      renderNotificationCard(
        notification("experiment.status.started", {
          type: "started",
          experimentId: "exp-1",
          experimentName: "Checkout",
          linkedFeatureCount: 1,
          phaseName: "Main phase",
          goalMetricNames: ["Conversion", "Revenue", "Retention", "NPS"],
        }),
        "dark",
      ),
    ).resolves.toMatchObject({
      altText: "Checkout - Experiment Started",
      eventLabel: "Experiment Started",
      objectName: "Checkout",
    });
    expect(renderCard).toHaveBeenCalledWith(
      expect.objectContaining({
        tone: "info",
        icon: "play",
        banner: "Experiment Started",
        sections: [
          {
            kind: "fields",
            fields: [
              {
                label: "Goal metrics",
                value: "Conversion, Revenue, Retention (+1 more)",
              },
              { label: "Linked changes", value: "1 Feature Flag" },
            ],
          },
        ],
      }),
      "dark",
    );
  });

  it("renders the stopped card without claiming an outcome that was not recorded", async () => {
    await renderNotificationCard(
      notification("experiment.status.stopped", {
        type: "stopped",
        experimentId: "exp-1",
        experimentName: "Checkout",
        enableTemporaryRollout: false,
      }),
      "light",
    );
    expect(renderCard).toHaveBeenCalledWith(
      expect.objectContaining({
        tone: "neutral",
        icon: "stop",
        banner: "Experiment Stopped",
        sections: [
          {
            kind: "fields",
            fields: [
              { label: "Result", value: "Stopped without a recorded outcome" },
            ],
          },
        ],
      }),
      "light",
    );
  });

  it("renders goal metric results as a winner card when the payload carries them", async () => {
    await renderNotificationCard(
      notification("experiment.status.stopped", {
        type: "stopped",
        experimentId: "exp-1",
        experimentName: "Checkout",
        results: "won",
        enableTemporaryRollout: false,
        winningVariationName: "Treatment",
        winningVariationIndex: 1,
        totalUsers: 20000,
        durationDays: 21,
        goalMetric: {
          metricId: "m1",
          metricName: "Conversion",
          snapshotId: "snp-1",
          statsEngine: "bayesian",
          differenceType: "relative",
          control: {
            variationId: "v0",
            variationName: "Control",
            users: 10000,
            value: 0.05,
          },
          variations: [
            {
              variationId: "v1",
              variationName: "Treatment",
              variationIndex: 1,
              users: 10000,
              value: 0.055,
              uplift: 0.1,
              upliftStddev: 0.02,
              ci: [0.06, 0.14],
              chanceToWin: 0.98,
              significant: true,
            },
          ],
        },
      }),
      "light",
    );
    expect(renderCard).toHaveBeenCalledWith(
      expect.objectContaining({
        tone: "success",
        icon: "trophy",
        banner: "Experiment Stopped - Winner",
        footer: "20,000 units - 21 days",
        sections: [
          {
            kind: "callout",
            callout: {
              label: "Conclusion",
              markdown: "Variation *Treatment* won.",
            },
          },
          {
            kind: "results",
            results: {
              sectionLabel: "Goal metric",
              title: "Conversion",
              statLabel: "Chance to win",
              changeLabel: "Lift",
              axis: { domain: [-20, 20], labels: ["-20%", "0", "+20%"] },
              rows: [
                expect.objectContaining({
                  v: "Treatment",
                  i: 1,
                  stat: "98.0%",
                  sig: true,
                  chg: "+10%",
                  dir: "up",
                  good: true,
                  vio: { c: 10, s: 2 },
                  interval: "95% Credible Interval [+6%, +14%]",
                }),
              ],
            },
          },
        ],
      }),
      "light",
    );
  });

  it("reports a stop result and temporary rollout from the payload", async () => {
    await renderNotificationCard(
      notification("experiment.status.stopped", {
        type: "stopped",
        experimentId: "exp-1",
        experimentName: "Checkout",
        results: "inconclusive",
        enableTemporaryRollout: true,
        releasedVariationName: "Control",
      }),
      "light",
    );
    expect(renderCard).toHaveBeenCalledWith(
      expect.objectContaining({
        banner: "Experiment Stopped - Inconclusive",
        sections: [
          {
            kind: "fields",
            fields: [
              { label: "Result", value: "Inconclusive" },
              { label: "Temporary rollout", value: "Variation *Control*" },
            ],
          },
        ],
      }),
      "light",
    );
  });

  it("shows the p-value instead of chance to win for frequentist results", async () => {
    await renderNotificationCard(
      notification("experiment.status.stopped", {
        type: "stopped",
        experimentId: "exp-1",
        experimentName: "Checkout",
        results: "lost",
        enableTemporaryRollout: false,
        goalMetric: {
          metricId: "m1",
          metricName: "Conversion",
          snapshotId: "snp-1",
          statsEngine: "frequentist",
          pValueThreshold: 0.1,
          differenceType: "relative",
          control: {
            variationId: "v0",
            variationName: "Control",
            value: 0.05,
          },
          variations: [
            {
              variationId: "v1",
              variationName: "Treatment",
              variationIndex: 1,
              value: 0.046,
              uplift: -0.08,
              ci: [-0.12, -0.04],
              pValue: 0.0004,
              significant: true,
            },
          ],
        },
      }),
      "dark",
    );
    expect(renderCard).toHaveBeenCalledWith(
      expect.objectContaining({
        tone: "danger",
        icon: "x",
        banner: "Experiment Stopped - Lost",
        sections: [
          {
            kind: "results",
            results: expect.objectContaining({
              statLabel: "p-value",
              rows: [
                expect.objectContaining({
                  stat: "<0.001",
                  sig: true,
                  chg: "-8%",
                  dir: "down",
                  good: false,
                  interval: "90% Confidence Interval [-12%, -4%]",
                }),
              ],
            }),
          },
        ],
      }),
      "dark",
    );
  });

  it("names the interval without a level when the payload predates the threshold", async () => {
    await renderNotificationCard(
      notification("experiment.status.stopped", {
        type: "stopped",
        experimentId: "exp-1",
        experimentName: "Checkout",
        results: "lost",
        enableTemporaryRollout: false,
        goalMetric: {
          metricId: "m1",
          metricName: "Conversion",
          snapshotId: "snp-1",
          statsEngine: "frequentist",
          differenceType: "relative",
          control: { variationId: "v0", variationName: "Control", value: 0.05 },
          variations: [
            {
              variationId: "v1",
              variationName: "Treatment",
              variationIndex: 1,
              value: 0.046,
              uplift: -0.08,
              ci: [-0.12, -0.04],
              pValue: 0.0004,
              significant: true,
            },
          ],
        },
      }),
      "light",
    );
    expect(renderCard).toHaveBeenCalledWith(
      expect.objectContaining({
        sections: expect.arrayContaining([
          {
            kind: "results",
            results: expect.objectContaining({
              rows: [
                expect.objectContaining({
                  interval: "Confidence Interval [-12%, -4%]",
                }),
              ],
            }),
          },
        ]),
      }),
      "light",
    );
  });

  it("widens the results axis when a lift runs past the default range", async () => {
    await renderNotificationCard(
      notification("experiment.status.stopped", {
        type: "stopped",
        experimentId: "exp-1",
        experimentName: "Checkout",
        results: "won",
        enableTemporaryRollout: false,
        goalMetric: {
          metricId: "m1",
          metricName: "Conversion",
          snapshotId: "snp-1",
          statsEngine: "bayesian",
          differenceType: "relative",
          control: { variationId: "v0", variationName: "Control", value: 0.05 },
          variations: [
            {
              variationId: "v1",
              variationName: "Treatment",
              variationIndex: 1,
              value: 0.072,
              uplift: 0.44,
              upliftStddev: 0.03,
              ci: [0.38, 0.5],
              chanceToWin: 0.99,
              significant: true,
            },
          ],
        },
      }),
      "light",
    );
    expect(renderCard).toHaveBeenCalledWith(
      expect.objectContaining({
        sections: expect.arrayContaining([
          {
            kind: "results",
            results: expect.objectContaining({
              axis: { domain: [-50, 50], labels: ["-50%", "0", "+50%"] },
            }),
          },
        ]),
      }),
      "light",
    );
  });

  it("treats a drop in an inverse metric as the good direction", async () => {
    await renderNotificationCard(
      notification("experiment.status.stopped", {
        type: "stopped",
        experimentId: "exp-1",
        experimentName: "Checkout",
        results: "won",
        enableTemporaryRollout: false,
        winningVariationName: "Treatment",
        winningVariationIndex: 1,
        goalMetric: {
          metricId: "m1",
          metricName: "Bounce rate",
          inverse: true,
          snapshotId: "snp-1",
          statsEngine: "bayesian",
          differenceType: "relative",
          control: { variationId: "v0", variationName: "Control", value: 0.4 },
          variations: [
            {
              variationId: "v1",
              variationName: "Treatment",
              variationIndex: 1,
              value: 0.368,
              uplift: -0.08,
              chanceToWin: 0.99,
              significant: true,
            },
          ],
        },
      }),
      "dark",
    );
    expect(renderCard).toHaveBeenCalledWith(
      expect.objectContaining({
        sections: expect.arrayContaining([
          {
            kind: "results",
            results: expect.objectContaining({
              rows: [expect.objectContaining({ dir: "down", good: true })],
            }),
          },
        ]),
      }),
      "dark",
    );
  });

  it("shows a dash instead of a fabricated lift when the payload has no estimate", async () => {
    await renderNotificationCard(
      notification("experiment.status.stopped", {
        type: "stopped",
        experimentId: "exp-1",
        experimentName: "Checkout",
        results: "inconclusive",
        enableTemporaryRollout: false,
        goalMetric: {
          metricId: "m1",
          metricName: "Conversion",
          snapshotId: "snp-1",
          statsEngine: "bayesian",
          differenceType: "relative",
          control: { variationId: "v0", variationName: "Control", value: 0.05 },
          variations: [
            {
              variationId: "v1",
              variationName: "Treatment",
              variationIndex: 1,
              value: 0.05,
              chanceToWin: 0.5,
            },
          ],
        },
      }),
      "dark",
    );
    const [card] = jest.mocked(renderCard).mock.calls[0];
    const results = card.sections.find(
      (s): s is Extract<CardSection, { kind: "results" }> =>
        s.kind === "results",
    );
    expect(results?.results.rows).toEqual([
      { v: "Treatment", i: 1, sig: false, stat: "50.0%" },
    ]);
  });

  it("keeps markdown characters in variation names literal", async () => {
    await renderNotificationCard(
      notification("experiment.status.stopped", {
        type: "stopped",
        experimentId: "exp-1",
        experimentName: "Checkout",
        results: "won",
        enableTemporaryRollout: true,
        releasedVariationName: "2*_fast_*",
        winningVariationName: "2*_fast_*",
        winningVariationIndex: 1,
        reason: "*Ship it*",
      }),
      "light",
    );
    expect(renderCard).toHaveBeenCalledWith(
      expect.objectContaining({
        sections: [
          {
            kind: "fields",
            fields: [
              { label: "Result", value: "Won" },
              {
                label: "Temporary rollout",
                value: "Variation *2\\*\\_fast\\_\\**",
              },
              { label: "Reason", value: "\\*Ship it\\*" },
            ],
          },
        ],
      }),
      "light",
    );
  });

  it("leaves events with no producer as text", async () => {
    await expect(
      renderNotificationCard(
        notification("experiment.info.significance", {
          experimentId: "exp-1",
          metricId: "metric-2",
          variationId: "variation-3",
        }),
        "light",
      ),
    ).resolves.toBeNull();
    expect(renderCard).not.toHaveBeenCalled();
  });

  it("skips the card when the SRM payload is incomplete", async () => {
    await expect(
      renderNotificationCard(
        notification("experiment.warning", {
          type: "srm",
          experimentId: "exp-1",
        }),
        "light",
      ),
    ).resolves.toBeNull();
    expect(renderCard).not.toHaveBeenCalled();
  });

  it("renders each stored event once per format across deliveries", async () => {
    const options = { eventId: "event_cache_1" };
    const first = await renderNotificationCard(srmWarning, "light", options);
    const second = await renderNotificationCard(srmWarning, "light", options);
    await renderNotificationCard(srmWarning, "dark", options);
    await renderNotificationCard(srmWarning, "light", {
      eventId: "event_cache_2",
    });
    expect(second).toBe(first);
    expect(renderCard).toHaveBeenCalledTimes(3);
  });

  it("falls back to text when rendering fails", async () => {
    jest.mocked(renderCard).mockRejectedValue(new Error("boom"));
    await expect(
      renderNotificationCard(srmWarning, "light"),
    ).resolves.toBeNull();
  });
});
