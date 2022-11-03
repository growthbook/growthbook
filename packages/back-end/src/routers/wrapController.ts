// Wrap every controller function in asyncHandler to catch errors properly
import asyncHandler from "express-async-handler";
import { RequestHandler } from "express";

// eslint-disable-next-line
type Handler = RequestHandler<any>;
type Controller<T extends string> = Record<T, Handler>;

export function wrapController<T extends string>(
  // eslint-disable-next-line
  controller: Record<T, any>
): Controller<T> {
  const newController = {} as Controller<T>;
  Object.keys(controller).forEach((key: T) => {
    // Sanity check in case someone exports a non-function from the controller file
    if (typeof controller[key] === "function") {
      newController[key] = asyncHandler(controller[key]);
    }
  });
  return newController;
}
