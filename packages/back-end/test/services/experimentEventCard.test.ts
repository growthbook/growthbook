import type { NotificationEvent } from "shared/types/events/notification-events";
import { renderExperimentNotificationCard } from "back-end/src/services/notificationCards/experimentEventCard";
import { renderExperimentCard } from "back-end/src/services/notificationCards/experimentCards";

jest.mock("back-end/src/services/notificationCards/experimentCards", () => ({
  renderExperimentCard: jest.fn(),
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

describe("renderExperimentNotificationCard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(renderExperimentCard).mockResolvedValue(Buffer.from("png"));
  });

  it("renders the SRM warning card from the event payload alone", async () => {
    await expect(renderExperimentNotificationCard(srmWarning)).resolves.toEqual(
      {
        png: Buffer.from("png"),
        altText: "Checkout — experiment results",
        caption: "Health alert",
        experimentId: "exp-1",
      },
    );
    expect(renderExperimentCard).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "warning",
        state: "warning",
        key: "exp-1",
        rows: [],
        summary: ["Sample ratio mismatch detected.", "SRM threshold: 0.001"],
      }),
      "compact",
    );
  });

  it.each(["compact", "detailed"] as const)(
    "passes the %s format through to the renderer",
    async (format) => {
      await renderExperimentNotificationCard(srmWarning, format);
      expect(renderExperimentCard).toHaveBeenCalledWith(
        expect.anything(),
        format,
      );
    },
  );

  it("renders nothing when cards are turned off", async () => {
    await expect(
      renderExperimentNotificationCard(srmWarning, "none"),
    ).resolves.toBeNull();
    expect(renderExperimentCard).not.toHaveBeenCalled();
  });

  it.each(["no-data", "underpowered", "multiple-exposures"])(
    "leaves the %s warning as an accurate text notification",
    async (type) => {
      await expect(
        renderExperimentNotificationCard(
          notification("experiment.warning", {
            type,
            experimentId: "exp-1",
            experimentName: "Checkout",
          }),
        ),
      ).resolves.toBeNull();
      expect(renderExperimentCard).not.toHaveBeenCalled();
    },
  );

  it("leaves events without an immutable card as text", async () => {
    await expect(
      renderExperimentNotificationCard(
        notification("experiment.info.significance", {
          experimentId: "exp-1",
          metricId: "metric-2",
          variationId: "variation-3",
        }),
      ),
    ).resolves.toBeNull();
    expect(renderExperimentCard).not.toHaveBeenCalled();
  });

  it("skips the card when the SRM payload is incomplete", async () => {
    await expect(
      renderExperimentNotificationCard(
        notification("experiment.warning", {
          type: "srm",
          experimentId: "exp-1",
        }),
      ),
    ).resolves.toBeNull();
    expect(renderExperimentCard).not.toHaveBeenCalled();
  });

  it("falls back to text when rendering fails", async () => {
    jest.mocked(renderExperimentCard).mockRejectedValue(new Error("boom"));
    await expect(
      renderExperimentNotificationCard(srmWarning),
    ).resolves.toBeNull();
  });
});
