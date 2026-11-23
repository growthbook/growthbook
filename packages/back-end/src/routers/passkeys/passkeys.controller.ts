import { Response } from "express";
import {
  FinishPasskeyRegistrationBody,
  RenamePasskeyBody,
  StartPasskeyRegistrationBody,
} from "shared/validators";
import { UserInterface } from "shared/types/user";
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

async function getSignedInUser(req: AuthRequest<unknown>) {
  const user: UserInterface | null = req.userId
    ? await getUserById(req.userId)
    : null;
  if (!user) {
    throw new UnauthorizedError("You must be signed in to manage passkeys.");
  }
  return user;
}

export async function getPasskeys(req: AuthRequest, res: Response) {
  const user = await getSignedInUser(req);
  const passkeys = await getPasskeysByUserId(user.id);
  res.status(200).json({
    status: 200,
    passkeys: passkeys.map(toPasskeySummary),
  });
}

export async function postRegistrationOptions(
  req: AuthRequest<StartPasskeyRegistrationBody>,
  res: Response,
) {
  const user = await getSignedInUser(req);
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
  const user = await getSignedInUser(req);
  const passkey = await finishPasskeyRegistration(
    user,
    req.body.name.trim(),
    req.body.response,
  );
  res.status(200).json({ status: 200, passkey: toPasskeySummary(passkey) });
}

export async function putPasskey(
  req: AuthRequest<RenamePasskeyBody, { id: string }>,
  res: Response,
) {
  const user = await getSignedInUser(req);
  if (!(await renamePasskey(user.id, req.params.id, req.body.name.trim()))) {
    throw new NotFoundError("Passkey not found.");
  }
  res.status(200).json({ status: 200 });
}

export async function deletePasskeyById(
  req: AuthRequest<null, { id: string }>,
  res: Response,
) {
  const user = await getSignedInUser(req);
  if (!(await deletePasskey(user.id, req.params.id))) {
    throw new NotFoundError("Passkey not found.");
  }
  res.status(200).json({ status: 200 });
}
