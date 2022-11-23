/**
 * Common handler that looks up the web hooks and makes a post request with the event.
 */
export const webHooksEventHandler = async (eventId: string): Promise<void> => {
  console.log("webHooksEventHandler -> ", eventId);
};
