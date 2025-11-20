import { initializeClient, GSS_MECH_OID_SPNEGO } from "kerberos";
import { logger } from "./logger";

export async function getKerberosHeader(
  servicePrincipal: string,
  clientPrincipal: string,
): Promise<string> {
  const formattedServicePrincipal = formatServicePrincipal(servicePrincipal);
  const client = await initializeClient(formattedServicePrincipal, {
    mechOID: GSS_MECH_OID_SPNEGO,
    principal: clientPrincipal,
  });
  let token = "";
  try {
    token = await client.step("");
  } catch (e) {
    logger.error(e, "Failed on client.step");
    throw e;
  }
  const header = `Negotiate ${token}`;
  logger.info("Kerberos header value: %s", header);
  return header;
}

/**
 * Convert from Kerberos principal format (HTTP/host@REALM)
 * to kerberos library format (HTTP@host)
 * or return the original principal if it is already in the correct format
 */
function formatServicePrincipal(servicePrincipal: string): string {
  const principalMatch = servicePrincipal.match(KERBEROS_PRINCIPAL_MATCH_REGEX);
  if (principalMatch) {
    const [, serviceType, hostname] = principalMatch;
    return `${serviceType}@${hostname}`;
  }
  return servicePrincipal;
}

const KERBEROS_PRINCIPAL_MATCH_REGEX = /^([^/]+)\/([^@]+)(@.*)?$/;
