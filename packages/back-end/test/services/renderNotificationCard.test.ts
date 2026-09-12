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
      caption: expect.stringMatching(
        /^<https?:\/\/[^|]+\/experiment\/exp-1\|Checkout> - Health issue$/,
      ),
    });
    expect(renderCard).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "warning",
        state: "warning",
        key: "exp-1",
        summary: ["Sample ratio mismatch detected."],
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
