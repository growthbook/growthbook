import { Router } from "express";
import z from "zod";
import { createTodo, getTodos } from "./todos.controller";
import { validateRequestMiddleware } from "../../middleware/validate-request.middleware";

const router = Router();

router.get("/", getTodos);

router.post(
  "/",
  validateRequestMiddleware({
    body: z.object({
      title: z.string(),
      description: z.string(),
    }),
  }),
  createTodo
);

export { router as todosRouter };
