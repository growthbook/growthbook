import { performance } from "node:perf_hooks";
import kerberos from "kerberos";
import type { InitializeClientOptions } from "kerberos";
import { logger } from "./logger.js";
import { IS_CLOUD } from "./secrets.js";

const { initializeClient, GSS_MECH_OID_KRB5 } = kerberos;
export async function getKerberosHeader(
  servicePrincipal: string,
  clientPrincipal?: string,
): Promise<string> {
  // As we can't use Kerberos in Cloud, ensure we don't try to use it
  if (IS_CLOUD) {
    throw new Error(
      "Kerberos authentication is not supported in GrowthBook Cloud",
    );
  }

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
