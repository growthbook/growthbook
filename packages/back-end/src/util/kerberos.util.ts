import { initializeClient, GSS_MECH_OID_KRB5 } from "kerberos";

export async function getKerberosHeader(
  servicePrincipal: string,
): Promise<string> {
  const formattedServicePrincipal = formatServicePrincipal(servicePrincipal);
  const client = await initializeClient(formattedServicePrincipal, {
    mechOID: GSS_MECH_OID_KRB5,
  });
  const token = await client.step("");
  const header = `Negotiate ${Buffer.from(token).toString("base64")}`;
  return header;
}

/**
 * Convert from Kerberos principal format (HTTP/host@REALM) (eg. HTTP/trino.example.com@EXAMPLE.COM)
 * to kerberos library format (HTTP@host) (eg. HTTP@trino.example.com)
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
