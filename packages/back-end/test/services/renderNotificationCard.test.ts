import type { NotificationEvent } from "shared/types/events/notification-events";
import { renderNotificationCard } from "back-end/src/services/notificationCards/renderNotificationCard";
import { renderCard } from "back-end/src/services/notificationCards/cardStyles";

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
    await expect(
      renderNotificationCard(srmWarning, "compact"),
    ).resolves.toEqual({
      png: Buffer.from("png"),
      altText: "Checkout - Health issue",
      objectUrl: expect.stringMatching(/^https?:\/\/.+\/experiment\/exp-1$/),
      objectName: "Checkout",
      eventLabel: "Health issue",
    });
    expect(renderCard).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "warning",
        state: "warning",
        key: "exp-1",
        banner: "Health Alert - SRM Detected",
      }),
      "compact",
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
      "compact",
    );
    expect(renderCard).toHaveBeenCalledWith(
      expect.objectContaining({
        table: {
          columns: ["Variation", "Units", "Actual %", "Expected %"],
          rows: [
            ["Control", "6,200", "62%", "50%"],
            ["Treatment", "3,800", "38%", "50%"],
          ],
          note: "10,000 total units · p-value = <0.001",
        },
      }),
      "compact",
    );
  });

  it.each(["compact", "compact-dark", "detailed"] as const)(
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
          "compact",
        ),
      ).resolves.toBeNull();
      expect(renderCard).not.toHaveBeenCalled();
    },
  );

  it("renders the started card with a banner and the launch summary", async () => {
    await expect(
      renderNotificationCard(
        notification("experiment.status.started", {
          type: "started",
          experimentId: "exp-1",
          experimentName: "Checkout",
          linkedFeatureCount: 1,
          phaseName: "Main phase",
        }),
        "detailed",
      ),
    ).resolves.toMatchObject({
      altText: "Checkout - Experiment started",
      eventLabel: "Experiment started",
      objectName: "Checkout",
    });
    expect(renderCard).toHaveBeenCalledWith(
      expect.objectContaining({
        state: "started",
        event: "started",
        banner: "Experiment Started",
        summary: expect.arrayContaining(["Phase: Main phase"]),
      }),
      "detailed",
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
      "compact",
    );
    expect(renderCard).toHaveBeenCalledWith(
      expect.objectContaining({
        state: "stopped",
        event: "stopped",
        banner: "Experiment Stopped",
        summary: ["Experiment stopped."],
      }),
      "compact",
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
      "compact",
    );
    expect(renderCard).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: [
          "Experiment stopped. Result: inconclusive.",
          "Temporary rollout: Control",
        ],
      }),
      "compact",
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
        "compact",
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
        "compact",
      ),
    ).resolves.toBeNull();
    expect(renderCard).not.toHaveBeenCalled();
  });

  it("falls back to text when rendering fails", async () => {
    jest.mocked(renderCard).mockRejectedValue(new Error("boom"));
    await expect(
      renderNotificationCard(srmWarning, "compact"),
    ).resolves.toBeNull();
  });
});
