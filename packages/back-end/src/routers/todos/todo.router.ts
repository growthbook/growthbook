import { Router } from "express";
import z from "zod";
import { createTodo, getTodo, getTodos } from "./todos.controller";
import { validateRequestMiddleware } from "../../middleware/validate-request.middleware";
import asyncHandler from "express-async-handler";

const router = Router();

router.get("/", asyncHandler(getTodos));

router.post(
  "/",
  // This isn't pretty, maybe we find another way to work with how we do error handling
  asyncHandler(
    validateRequestMiddleware({
      body: z.object({
        title: z.string(),
        description: z.string(),
      }),
    })
  ),
  asyncHandler(createTodo)
);

router.get("/:index", asyncHandler(getTodo));

export { router as todosRouter };
