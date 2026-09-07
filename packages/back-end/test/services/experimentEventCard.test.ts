import type { NotificationEvent } from "shared/types/events/notification-events";
import { renderExperimentNotificationCard } from "back-end/src/services/notificationCards/experimentEventCard";
import {
  sampleCard,
  type CardState,
} from "back-end/src/services/notificationCards/cardImages";
import { buildExperimentCardData } from "back-end/src/services/notificationCards/experimentCardData";
import { renderExperimentCard } from "back-end/src/services/notificationCards/experimentCards";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";

jest.mock("back-end/src/services/notificationCards/experimentCardData", () => ({
  buildExperimentCardData: jest.fn(),
}));

jest.mock("back-end/src/services/notificationCards/experimentCards", () => ({
  renderExperimentCard: jest.fn(),
}));

jest.mock("back-end/src/services/organizations", () => ({
  getContextForAgendaJobByOrgId: jest.fn(),
}));

const notification = (
  event: string,
  object: Record<string, unknown>,
): NotificationEvent =>
  ({
    event,
    data: { object },
  }) as unknown as NotificationEvent;

describe("renderExperimentNotificationCard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getContextForAgendaJobByOrgId).mockResolvedValue({} as never);
    jest
      .mocked(buildExperimentCardData)
      .mockResolvedValue(sampleCard("warning"));
    jest.mocked(renderExperimentCard).mockResolvedValue(Buffer.from("png"));
  });

  it("renders the SRM-specific warning card", async () => {
    await expect(
      renderExperimentNotificationCard(
        notification("experiment.warning", {
          type: "srm",
          experimentId: "exp-1",
        }),
        "org-1",
      ),
    ).resolves.toEqual({
      png: Buffer.from("png"),
      altText: "Onboarding tour v3 — experiment results",
      caption: "Health alert",
      experimentId: "exp-1",
    });

    expect(buildExperimentCardData).toHaveBeenCalledWith(
      expect.anything(),
      "exp-1",
    );
    expect(renderExperimentCard).toHaveBeenCalledWith(
      expect.objectContaining({ event: "warning" }),
      "compact",
    );
  });

  it.each<CardState>(["running", "stopped", "winner", "loser", "started"])(
    "keeps a delayed SRM event text-only when current results are %s",
    async (state) => {
      jest.mocked(buildExperimentCardData).mockResolvedValue(sampleCard(state));
      for (const format of ["compact", "detailed"] as const) {
        await expect(
          renderExperimentNotificationCard(
            notification("experiment.warning", {
              type: "srm",
              experimentId: "exp-1",
            }),
            "org-1",
            format,
          ),
        ).resolves.toBeNull();
      }
      expect(renderExperimentCard).not.toHaveBeenCalled();
    },
  );

  it.each(["no-data", "underpowered", "multiple-exposures"])(
    "leaves the %s warning as an accurate text notification",
    async (type) => {
      await expect(
        renderExperimentNotificationCard(
          notification("experiment.warning", {
            type,
            experimentId: "exp-1",
          }),
          "org-1",
        ),
      ).resolves.toBeNull();

      expect(buildExperimentCardData).not.toHaveBeenCalled();
    },
  );

  it("leaves significance events as text until event-specific metrics are supported", async () => {
    await expect(
      renderExperimentNotificationCard(
        notification("experiment.info.significance", {
          experimentId: "exp-1",
          metricId: "metric-2",
          variationId: "variation-3",
        }),
        "org-1",
      ),
    ).resolves.toBeNull();

    expect(buildExperimentCardData).not.toHaveBeenCalled();
  });
});
