import bodyParser from "body-parser";
import express, {
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import { SLACK_SIGNING_SECRET } from "back-end/src/util/secrets";
import { isSlackSignatureValid } from "back-end/src/services/slack/slackRequestSignature";
import * as rawSlackActionsController from "./slack-actions.controller";

const router = express.Router();

const slackActionsController = wrapController(rawSlackActionsController);

type RawBodyRequest = Request & { rawBody?: string };

// Slack signs the raw request bytes, so both parsers keep them for the
// signature check. The global JSON parser in app.ts cannot do this: it has no
// `verify` hook, and body-parser skips a body an earlier parser already
// consumed, so this router is mounted ahead of it and parses for itself.
// Interactivity posts application/x-www-form-urlencoded and the Events API
// posts application/json; each parser only acts on its own content type.
const captureRawBody = (req: RawBodyRequest, _res: Response, buf: Buffer) => {
  req.rawBody = buf.toString("utf8");
};
const slackJsonParser = bodyParser.json({ verify: captureRawBody });
const slackFormParser = bodyParser.urlencoded({
  extended: false,
  verify: captureRawBody,
});

const requireSlackSignature = (
  req: RawBodyRequest,
  res: Response,
  next: NextFunction,
) => {
  const valid = isSlackSignatureValid({
    secret: SLACK_SIGNING_SECRET,
    timestamp: req.header("x-slack-request-timestamp"),
    signature: req.header("x-slack-signature"),
    rawBody: req.rawBody,
  });
  if (!valid) {
    return res.status(401).json({ text: "Invalid Slack signature." });
  }
  next();
};

// Every inbound Slack route goes through this registrar so none can skip the
// signed-body chain. Not `router.use`: the session-authed
// slackIntegrationRouter shares the /integrations/slack prefix and must not
// be gated by Slack signatures.
const signedSlackPost = (path: string, ...handlers: RequestHandler[]) =>
  router.post(
    path,
    slackJsonParser,
    slackFormParser,
    requireSlackSignature,
    ...handlers,
  );

signedSlackPost(
  "/interactions",
  validateRequestMiddleware({ body: z.object({ payload: z.string() }) }),
  slackActionsController.postSlackInteractions,
);

signedSlackPost("/events", slackActionsController.postSlackEvents);

export { router as slackActionsRouter };
