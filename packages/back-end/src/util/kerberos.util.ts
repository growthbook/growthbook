import { performance } from "node:perf_hooks";
import {
  initializeClient,
  InitializeClientOptions,
  GSS_MECH_OID_KRB5,
} from "kerberos";
import { logger } from "./logger";

export async function getKerberosHeader(
  servicePrincipal: string,
  clientPrincipal?: string,
): Promise<string> {
  const startTime = performance.now();
  const formattedServicePrincipal = formatServicePrincipal(servicePrincipal);
  const clientOptions: InitializeClientOptions = {
    mechOID: GSS_MECH_OID_KRB5,
  };
  if (clientPrincipal) {
    clientOptions.principal = clientPrincipal;
  }
  const client = await initializeClient(
    formattedServicePrincipal,
    clientOptions,
  );
  const token = await client.step("");
  const endTime = performance.now();
  logger.debug("Got Kerberos token in %dms", endTime - startTime);
  return `Negotiate ${token}`;
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
