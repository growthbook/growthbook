import { App as SlackApp } from "@slack/bolt";
import { FileInstallationStore } from "@slack/oauth";
import { logger } from "../../util/logger";

type SlackManagerOptions = {
  botToken: string;
  signingSecret: string;
  port: string;
  oauth: {
    clientId: string;
    clientSecret: string;
    stateSecret: string;
  };
};

// TODO: Authorize user (for Cloud and self-hosted)

export class SlackManager {
  private readonly port: string;
  private readonly slackApp: SlackApp;

  constructor({ signingSecret, port, oauth }: SlackManagerOptions) {
    this.port = port;

    const { clientId, clientSecret, stateSecret } = oauth;

    this.slackApp = new SlackApp({
      // Cannot use bot token for multi-workspace apps
      // token: botToken,
      signingSecret,
      clientId,
      clientSecret,
      stateSecret,
      installerOptions: {
        directInstall: true,
      },
      // Can only request bot-level scopes??
      scopes: [
        // User
        // "identity.basic",
        // "identity.email",
        // Bot
        "chat:write",
        "commands",
        "team:read",
        "users:read",
        "users:read.email",
      ],
      // https://455c-192-252-230-22.ngrok.io/slack/install
      // https://455c-192-252-230-22.ngrok.io/slack/oauth_redirect
      installationStore: new FileInstallationStore(),
      // TODO: the real deal
      // installationStore: {
      //   storeInstallation: async (installation) => {
      //     console.log("installation", installation);
      //   },
      //   // TODO: Figure this out
      //   fetchInstallation: async (installQuery) => {
      //     console.log("fetchInstallation -> installQuery", installQuery);
      //     throw new Error("Failed fetching installation");
      //   },
      //   deleteInstallation: async (installQuery) => {
      //     console.log("deleteInstallation -> installQuery", installQuery);
      //   },
      // },
    });
  }

  /**
   * Registers all of the listeners
   */
  public async init() {
    await this.slackApp.start(this.port);

    this.registerActions();
    this.registerCommands();
    this.registerEvents();
  }

  /**
   * https://slack.dev/bolt-js/concepts#commands
   */
  private registerCommands() {
    this.slackApp.command(
      "/ping",
      async ({ /*body, context,*/ command, ack, respond }) => {
        await ack();

        await respond(
          `<@${command.user_name}> pong! :table_tennis_paddle_and_ball:`
        );

        // console.log({ body, context });
      }
    );
  }

  /**
   * https://slack.dev/bolt-js/concepts#action-listening
   */
  private registerActions() {
    this.slackApp.action("welcome_button", async ({ ack }) => {
      logger.info("Clicked the welcome button!");
      await ack();
    });
  }

  /**
   * https://slack.dev/bolt-js/concepts#event-listening
   */
  private registerEvents() {
    this.slackApp.event(
      "app_home_opened",
      async ({ /*say, */ event, client }) => {
        // try {
        //   await say(`Thanks for opening the home tab, <@${event.user}>!`);
        // } catch (error) {
        //   logger.error(error);
        // }

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
                    text: "*Welcome to the GrowthBook home tab!* :tada:",
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
                      "This button won't do much for now but you can set up a listener for it using the `actions()` method and passing its unique `action_id`.",
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
      }
    );
  }
}
