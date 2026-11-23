import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import {
  decodeClientDataJSON,
  isoBase64URL,
  isoUint8Array,
} from "@simplewebauthn/server/helpers";
import {
  PasskeyAuthenticationResponse,
  PasskeyInterface,
  PasskeyRegistrationResponse,
  PasskeySummary,
  PasskeyTransport,
  passkeyTransportValidator,
} from "shared/validators";
import { UserInterface } from "shared/types/user";
import {
  APP_ORIGIN,
  WEBAUTHN_RP_ID,
  WEBAUTHN_RP_NAME,
} from "back-end/src/util/secrets";
import { isDuplicateKeyError } from "back-end/src/util/mongo.util";
import { BadRequestError } from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";
import {
  createPasskey,
  getPasskeyByCredentialId,
  getPasskeysByUserId,
  recordPasskeyUse,
} from "back-end/src/models/PasskeyModel";
import { getUserById } from "back-end/src/models/UserModel";
import {
  consumePasskeyChallenge,
  PasskeyChallengeType,
  savePasskeyChallenge,
} from "back-end/src/models/PasskeyChallengeModel";

export function resolveRelyingPartyId(
  configured: string,
  appOrigin: string,
): string {
  let hostname: string;
  try {
    hostname = new URL(appOrigin).hostname;
  } catch {
    throw new Error(
      `APP_ORIGIN must be a full URL to use passkeys, got "${appOrigin}".`,
    );
  }
  if (!configured) return hostname;

  const rpId = configured.toLowerCase();
  // Browsers only accept the app's own domain or a parent domain of it
  if (hostname !== rpId && !hostname.endsWith(`.${rpId}`)) {
    throw new Error(
      `WEBAUTHN_RP_ID "${configured}" must be ${hostname} or a parent domain of it.`,
    );
  }
  return rpId;
}

type RelyingParty = { id: string; name: string; origin: string };

// The settings can't change while the server runs, so work this out once
let relyingParty: RelyingParty | null = null;

export function getRelyingParty(): RelyingParty {
  relyingParty ??= {
    id: resolveRelyingPartyId(WEBAUTHN_RP_ID, APP_ORIGIN),
    name: WEBAUTHN_RP_NAME,
    origin: APP_ORIGIN,
  };
  return relyingParty;
}

// Run at startup so a bad setting shows up in the logs straight away. It
// doesn't stop the server, since password sign-in still works.
export function checkPasskeySettings() {
  try {
    getRelyingParty();
  } catch (e) {
    logger.error(e, "Passkeys won't work until this setting is fixed");
  }
}

// Browsers may report transports newer than the spec we know about
export function toKnownTransports(transports: string[]): PasskeyTransport[] {
  return transports.flatMap((transport) => {
    const parsed = passkeyTransportValidator.safeParse(transport);
    return parsed.success ? [parsed.data] : [];
  });
}

export function toPasskeySummary(passkey: PasskeyInterface): PasskeySummary {
  return {
    id: passkey.id,
    name: passkey.name,
    deviceType: passkey.deviceType,
    backedUp: passkey.backedUp,
    dateCreated: passkey.dateCreated,
    lastUsed: passkey.lastUsed,
  };
}

// Deletes the challenge the browser signed before anything else is checked,
// so a failed attempt can't be retried with it. Returns null if it isn't one
// of ours or has expired.
async function takeChallenge(
  clientDataJSON: string,
  type: PasskeyChallengeType,
  userId: string | null,
): Promise<string | null> {
  let challenge: unknown;
  try {
    challenge = decodeClientDataJSON(clientDataJSON).challenge;
  } catch {
    return null;
  }
  if (typeof challenge !== "string") return null;
  return (await consumePasskeyChallenge(challenge, type, userId))
    ? challenge
    : null;
}

export async function startPasskeyRegistration(user: UserInterface) {
  const rp = getRelyingParty();
  const existing = await getPasskeysByUserId(user.id);

  const options = await generateRegistrationOptions({
    rpName: rp.name,
    rpID: rp.id,
    userName: user.email,
    userDisplayName: user.name || user.email,
    // A stable handle lets a password manager replace this user's passkey
    // instead of saving a second one
    userID: isoUint8Array.fromUTF8String(user.id),
    attestationType: "none",
    excludeCredentials: existing.map((passkey) => ({
      id: passkey.credentialId,
      transports: passkey.transports,
    })),
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
  });

  await savePasskeyChallenge(options.challenge, "registration", user.id);
  return options;
}

export async function finishPasskeyRegistration(
  userId: string,
  name: string,
  response: PasskeyRegistrationResponse,
): Promise<PasskeyInterface> {
  const rp = getRelyingParty();
  const couldNotVerify = new BadRequestError(
    "We couldn't verify this passkey. Please try adding it again.",
  );

  const challenge = await takeChallenge(
    response.response.clientDataJSON,
    "registration",
    userId,
  );
  if (!challenge) throw couldNotVerify;

  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      requireUserVerification: true,
    });
  } catch (e) {
    logger.warn(e, "Passkey registration could not be verified");
    throw couldNotVerify;
  }
  if (!verification.verified) throw couldNotVerify;

  const { credential, credentialDeviceType, credentialBackedUp } =
    verification.registrationInfo;
  try {
    return await createPasskey({
      userId,
      name,
      credentialId: credential.id,
      publicKey: isoBase64URL.fromBuffer(credential.publicKey),
      counter: credential.counter,
      transports: toKnownTransports(credential.transports ?? []),
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
    });
  } catch (e) {
    if (isDuplicateKeyError(e)) {
      throw new BadRequestError("This passkey has already been added.");
    }
    throw e;
  }
}

export async function startPasskeySignIn() {
  const rp = getRelyingParty();
  // No allowCredentials: the user hasn't said who they are yet, so the
  // browser offers every passkey it has for this site
  const options = await generateAuthenticationOptions({
    rpID: rp.id,
    userVerification: "required",
  });
  await savePasskeyChallenge(options.challenge, "authentication", null);
  return options;
}

export async function finishPasskeySignIn(
  response: PasskeyAuthenticationResponse,
): Promise<UserInterface> {
  const rp = getRelyingParty();
  const signInFailed = new BadRequestError(
    "We couldn't sign you in with that passkey.",
  );

  const challenge = await takeChallenge(
    response.response.clientDataJSON,
    "authentication",
    null,
  );
  if (!challenge) throw signInFailed;

  const passkey = await getPasskeyByCredentialId(response.id);
  if (!passkey) {
    // Usually a passkey the browser saved for this domain elsewhere, e.g.
    // another app on localhost or one that was removed here
    throw new BadRequestError(
      "This passkey isn't set up for this GrowthBook server. Sign in with your password, then add it under Passkeys in the account menu.",
    );
  }

  // The user didn't say who they are first, so the passkey has to, and it must
  // be its owner (WebAuthn §7.2 step 6)
  if (
    response.response.userHandle !== isoBase64URL.fromUTF8String(passkey.userId)
  ) {
    throw signInFailed;
  }

  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      credential: {
        id: passkey.credentialId,
        publicKey: isoBase64URL.toBuffer(passkey.publicKey),
        counter: passkey.counter,
        transports: passkey.transports,
      },
      requireUserVerification: true,
    });
  } catch (e) {
    logger.warn(e, "Passkey sign-in could not be verified");
    throw signInFailed;
  }
  if (!verification.verified) throw signInFailed;

  const user = await getUserById(passkey.userId);
  if (!user) throw signInFailed;

  const { newCounter, credentialBackedUp, credentialDeviceType } =
    verification.authenticationInfo;
  await recordPasskeyUse(passkey.id, {
    counter: newCounter,
    backedUp: credentialBackedUp,
    deviceType: credentialDeviceType,
  });
  return user;
}
