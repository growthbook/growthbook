import { isCloud } from "@/services/env";
import Callout from "@/ui/Callout";

export default function HostWarning({
  host,
  setHost,
}: {
  host?: string;
  setHost: (host: string) => void;
}) {
  // Trying to connect to localhost
  if (
    host &&
    host.match(/^([a-z0-9+-_]+:\/\/)?(localhost|127.0.0.1)($|[/?:])/)
  ) {
    if (isCloud()) {
      return (
        <Callout status="error">
          GrowthBook Cloud cannot access your local computer with that hostname.
          You must use a public ip address.
        </Callout>
      );
    }

    return (
      <Callout status="error">
        GrowthBook runs inside Docker. To connect to localhost, you should use{" "}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setHost("host.docker.internal");
          }}
        >
          host.docker.internal
        </a>{" "}
        (on Mac) or{" "}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setHost("172.17.0.1");
          }}
        >
          172.17.0.1
        </a>{" "}
        (on Linux).
      </Callout>
    );
  }

  if (isCloud()) {
    return (
      <Callout status="info">
        If your database is behind a firewall, add GrowthBook Cloud&apos;s ip (
        <code>52.70.79.40</code>) to your allowlist.
      </Callout>
    );
  }

  return null;
}
