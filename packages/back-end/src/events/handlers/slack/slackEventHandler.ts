/**
 * handle Slack events. Can be handled individually or with a common handler, depending on needs.
 * @param eventId
 */
export const slackEventHandler = async (eventId: string): Promise<void> => {
  console.log("slackEventHandler", eventId);
};
