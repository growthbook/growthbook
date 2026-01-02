import express from "express";
import { wrapController } from "back-end/src/routers/wrapController";
import * as rawController from "./url-redirects.controller";

const router = express.Router();

const urlRedirectController = wrapController(rawController);

router.post("/", urlRedirectController.postURLRedirect);
router.put("/:id", urlRedirectController.putURLRedirect);
router.delete("/:id", urlRedirectController.deleteURLRedirect);

export { router as urlRedirectRouter };
