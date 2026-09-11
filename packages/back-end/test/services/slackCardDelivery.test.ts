import { postExperimentCardImage } from "back-end/src/services/slack/cardDelivery";
import { uploadSlackImageFile } from "back-end/src/services/slack/slackWebApi";

jest.mock("back-end/src/services/slack/slackWebApi", () => ({
  uploadSlackImageFile: jest.fn().mockResolvedValue("F1"),
  postSlackMessage: jest.fn(),
}));

it("escapes customer names in file comments while preserving the experiment link", async () => {
  await postExperimentCardImage({
    token: "token",
    channel: "C1",
    png: Buffer.from("png"),
    altText: "<!channel> <@U123> experiment",
    viewLink: "<https://app.growthbook.io/experiment/exp_1|View experiment>",
  });
  expect(uploadSlackImageFile).toHaveBeenCalledWith(
    expect.objectContaining({
      initialComment:
        "&lt;!channel&gt; &lt;@U123&gt; experiment\n<https://app.growthbook.io/experiment/exp_1|View experiment>",
    }),
  );
});
