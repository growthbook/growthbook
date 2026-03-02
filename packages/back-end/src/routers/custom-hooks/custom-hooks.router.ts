import express from "express";
import { wrapController } from "back-end/src/routers/wrapController";
import * as rawCustomHooksController from "./custom-hooks.controller";

const router = express.Router();
const customHooksController = wrapController(rawCustomHooksController);

router.get("/", customHooksController.getCustomHooks);
router.post("/", customHooksController.createCustomHook);
router.post("/test", customHooksController.testCustomHook);
router.put("/:id", customHooksController.updateCustomHook);
router.delete("/:id", customHooksController.deleteCustomHook);

export { router as customHooksRouter };
