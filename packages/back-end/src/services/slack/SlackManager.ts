import { App as SlackApp } from "@slack/bolt";
import { logger } from "../../util/logger";

export class SlackManager {
  constructor(private slackApp: SlackApp) {}

  /**
   * Registers all of the listeners
   */
  public async init() {
    this.slackApp.command("/ping", async ({ command, ack, respond }) => {
      await ack();

      await respond(
        `<@${command.user_name}> pong! :table_tennis_paddle_and_ball:`
      );
    });

    this.slackApp.event("app_home_opened", async ({ event, client }) => {
      try {
        // TODO: delete this view
        await client.views.publish({
          user_id: event.user,

          view: {
            type: "home",
            callback_id: "home_view",

            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: "*Welcome to your _App's Home_* :tada:",
                },
              },
              {
                type: "divider",
              },
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text:
                    "This button won't do much for now but you can set up a listener for it using the `actions()` method and passing its unique `action_id`. See an example in the `examples` folder within your Bolt app.",
                },
              },
              {
                type: "actions",
                elements: [
                  {
                    action_id: "welcome_button",
                    type: "button",
                    text: {
                      type: "plain_text",
                      text: "Welcome! Click me!",
                    },
                  },
                ],
              },
            ],
          },
        });
      } catch (error) {
        logger.error(error);
      }
    });
  }
}
