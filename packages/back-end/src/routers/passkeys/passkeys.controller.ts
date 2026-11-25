import { Response } from "express";
import {
  FinishPasskeyRegistrationBody,
  RenamePasskeyBody,
  StartPasskeyRegistrationBody,
} from "shared/validators";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getUserById } from "back-end/src/models/UserModel";
import {
  deletePasskey,
  getPasskeysByUserId,
  renamePasskey,
} from "back-end/src/models/PasskeyModel";
import { verifyPassword } from "back-end/src/services/users";
import {
  finishPasskeyRegistration,
  startPasskeyRegistration,
  toPasskeySummary,
} from "back-end/src/services/passkeys";
import {
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
} from "back-end/src/util/errors";

const notSignedIn = () =>
  new UnauthorizedError("You must be signed in to manage passkeys.");

function getSignedInUserId(req: AuthRequest<unknown>): string {
  if (!req.userId) throw notSignedIn();
  return req.userId;
}

export async function getPasskeys(req: AuthRequest, res: Response) {
  const passkeys = await getPasskeysByUserId(getSignedInUserId(req));
  res.status(200).json({
    status: 200,
    passkeys: passkeys.map(toPasskeySummary),
  });
}

export async function postRegistrationOptions(
  req: AuthRequest<StartPasskeyRegistrationBody>,
  res: Response,
) {
  // The full user, since req.currentUser has no password hash
  const user = await getUserById(getSignedInUserId(req));
  if (!user) throw notSignedIn();
  // Re-check the password so a stolen session can't add its own passkey
  if (!(await verifyPassword(user, req.body.password))) {
    throw new BadRequestError("Your password is incorrect.");
  }
  const options = await startPasskeyRegistration(user);
  res.status(200).json({ status: 200, options });
}

export async function postRegistrationVerify(
  req: AuthRequest<FinishPasskeyRegistrationBody>,
  res: Response,
) {
  const passkey = await finishPasskeyRegistration(
    getSignedInUserId(req),
    req.body.name.trim(),
    req.body.response,
  );
  res.status(200).json({ status: 200, passkey: toPasskeySummary(passkey) });
}

export async function putPasskey(
  req: AuthRequest<RenamePasskeyBody, { id: string }>,
  res: Response,
) {
  const userId = getSignedInUserId(req);
  if (!(await renamePasskey(userId, req.params.id, req.body.name.trim()))) {
    throw new NotFoundError("Passkey not found.");
  }
  res.status(200).json({ status: 200 });
}

export async function deletePasskeyById(
  req: AuthRequest<null, { id: string }>,
  res: Response,
) {
  if (!(await deletePasskey(getSignedInUserId(req), req.params.id))) {
    throw new NotFoundError("Passkey not found.");
  }
  res.status(200).json({ status: 200 });
}
