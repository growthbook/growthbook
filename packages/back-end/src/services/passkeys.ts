import {
  APP_ORIGIN,
  WEBAUTHN_RP_ID,
  WEBAUTHN_RP_NAME,
} from "back-end/src/util/secrets";

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

export function getRelyingParty() {
  return {
    id: resolveRelyingPartyId(WEBAUTHN_RP_ID, APP_ORIGIN),
    name: WEBAUTHN_RP_NAME,
    origin: APP_ORIGIN,
  };
}
