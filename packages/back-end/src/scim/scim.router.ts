import { Router } from "express";
import bodyParser from "body-parser";
import authenticateApiRequestMiddleware from "../middleware/authenticateApiRequestMiddleware";
import usersRouter from "./users/users.router";

const router = Router();

router.use(bodyParser.json({ limit: "1mb" }));
router.use(bodyParser.urlencoded({ limit: "1mb", extended: true }));

router.use(authenticateApiRequestMiddleware);

// API endpoints
router.use("/users", usersRouter);

// 404 route
router.use(function (req, res) {
  res.status(404).json({
    message: "Unknown API endpoint",
  });
});

export default router;
