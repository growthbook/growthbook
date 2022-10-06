/* eslint-disable @typescript-eslint/no-empty-interface */
import * as z from "zod";
import { vUserInterface, vUserRef } from "../src/validators/user";

export interface UserInterface extends z.infer<typeof vUserInterface> {}
export interface UserRef extends z.infer<typeof vUserRef> {}
