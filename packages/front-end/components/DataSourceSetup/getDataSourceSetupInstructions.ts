import { DataSourceParams, DataSourceType } from "shared/types/datasource";
import { DocSection } from "@/components/docSections";
import { isCloud } from "@/services/env";

export type ConnectSetupKind = "custom" | "event_forwarder";

export type SetupInstructionStep = {
  title: string;
  description: string;
  /**
   * When set, `{link}` in `description` is replaced with a docs link.
   * `label` is the linked text.
   */
  docLink?: {
    section: DocSection;
    label: string;
  };
  code?: string;
  /** Shown under the code block. Backticks render as inline code. */
  codeNote?: string;
  /** When true, skip the all-caps transform (e.g. JSON policies, IAM role ids). */
  preserveCase?: boolean;
};

const CLOUD_EGRESS_IP = "52.70.79.40";

type ParamsBag = Partial<Record<string, unknown>>;

function asRecord(params: Partial<DataSourceParams> | undefined): ParamsBag {
  return (params ?? {}) as ParamsBag;
}

function field(params: ParamsBag, key: string, fallback: string): string {
  const value = params[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

function withEventForwarderWrite(
  steps: SetupInstructionStep[],
  writeStep: SetupInstructionStep | null,
): SetupInstructionStep[] {
  if (!writeStep) return steps;
  // Insert write access before the final "enter credentials" style step when
  // present; otherwise append.
  const last = steps[steps.length - 1];
  if (
    last &&
    /enter credentials|test the connection|add .+ in growthbook/i.test(
      last.title,
    )
  ) {
    return [...steps.slice(0, -1), writeStep, last];
  }
  return [...steps, writeStep];
}

const TEST_CONNECTION = "Enter the fields, then run the connection test.";

function postgresLikeSteps(
  params: ParamsBag,
  opts: {
    userFallback: string;
    databaseFallback: string;
    schemaFallback: string;
    portFallback: string;
    createUserSql: (user: string, database: string, schema: string) => string;
    networkDescription: (port: string) => string;
    includeEgressIp?: boolean;
  },
): SetupInstructionStep[] {
  const user = field(params, "user", opts.userFallback);
  const database = field(params, "database", opts.databaseFallback);
  const schema = field(params, "defaultSchema", opts.schemaFallback);
  const port = field(params, "port", opts.portFallback);

  return [
    {
      title: "Create a read-only user",
      description:
        "Use a dedicated role so GrowthBook cannot modify data. Grant SELECT only on the schemas that hold experiment assignment and metric events.",
      code: opts.createUserSql(user, database, schema || "public"),
      codeNote:
        "Replace `public` with your analytics schema if events live elsewhere.",
    },
    {
      title: "Allow network access",
      description: opts.networkDescription(port),
      code: opts.includeEgressIp
        ? `# GrowthBook Cloud egress IP
${CLOUD_EGRESS_IP}/32`
        : undefined,
    },
    {
      title: "Enter credentials and test",
      description: TEST_CONNECTION,
    },
  ];
}

export function getDataSourceSetupInstructions(
  type: DataSourceType,
  setup: ConnectSetupKind,
  params?: Partial<DataSourceParams>,
): SetupInstructionStep[] {
  const p = asRecord(params);
  const isEventForwarder = setup === "event_forwarder";

  switch (type) {
    case "bigquery": {
      const projectId = field(p, "projectId", "YOUR_PROJECT");
      const location = field(p, "location", "US");
      const sa = `growthbook@${projectId}.iam.gserviceaccount.com`;
      const member = `--member="serviceAccount:${sa}"`;

      const steps: SetupInstructionStep[] = [
        {
          title: "Create a service account",
          description:
            "Grant BigQuery Data Viewer, Metadata Viewer, and Job User. Console steps are in the {link}.",
          docLink: { section: "bigquery", label: "BigQuery guide" },
          // Role ids such as roles/bigquery.jobUser are case-sensitive.
          preserveCase: true,
          code: `gcloud iam service-accounts create growthbook \\
  --project=${projectId}
gcloud projects add-iam-policy-binding ${projectId} \\
  ${member} \\
  --role="roles/bigquery.dataViewer"
gcloud projects add-iam-policy-binding ${projectId} \\
  ${member} \\
  --role="roles/bigquery.metadataViewer"
gcloud projects add-iam-policy-binding ${projectId} \\
  ${member} \\
  --role="roles/bigquery.jobUser"`,
        },
        {
          title: "Create a JSON key",
          description: "In the console: Manage keys → Add key → JSON.",
          preserveCase: true,
          code: `gcloud iam service-accounts keys create \\
  growthbook-sa.json \\
  --iam-account=${sa}`,
        },
        {
          title: "Enter credentials and test",
          description: "Upload the JSON key, then run the connection test.",
        },
      ];

      if (!isEventForwarder) return steps;

      return withEventForwarderWrite(steps, {
        title: "Grant write access for Event Forwarder",
        description: "Grant BigQuery Data Editor on the destination dataset.",
        preserveCase: true,
        code: `CREATE SCHEMA \`${projectId}\`.growthbook_events
  OPTIONS (location = "${location}");
GRANT \`roles/bigquery.dataEditor\`
  ON SCHEMA \`${projectId}\`.growthbook_events
  TO "serviceAccount:${sa}";`,
      });
    }

    case "snowflake": {
      const role = field(p, "role", "GROWTHBOOK_ROLE");
      const user = field(p, "username", "GROWTHBOOK");
      const warehouse = field(p, "warehouse", "COMPUTE_WH");
      const database = field(p, "database", "ANALYTICS");
      const efSchema = field(p, "schema", "GROWTHBOOK_EVENTS");
      const authMethod =
        typeof p.authMethod === "string" ? p.authMethod : "key-pair";
      const workloadProvider =
        typeof p.workloadIdentityProvider === "string"
          ? p.workloadIdentityProvider
          : "AWS";
      const readGrants = `GRANT USAGE ON WAREHOUSE ${warehouse}
  TO ROLE ${role};

-- Read access for analysis
GRANT USAGE ON DATABASE ${database}
  TO ROLE ${role};
GRANT USAGE ON ALL SCHEMAS
  IN DATABASE ${database}
  TO ROLE ${role};
GRANT SELECT ON ALL TABLES
  IN DATABASE ${database}
  TO ROLE ${role};`;

      let createUserCode: string;
      let preserveUserSqlCase = false;
      if (authMethod === "workload-identity") {
        // ARNs, issuer URLs, and subjects are case-sensitive.
        preserveUserSqlCase = true;
        const identityBinding =
          workloadProvider === "AZURE"
            ? `CREATE USER ${user}
  WORKLOAD_IDENTITY = (
    TYPE = AZURE
    ISSUER = 'https://login.microsoftonline.com/<tenant_id>/v2.0'
    SUBJECT = '<managed_identity_object_id>'
  )
  TYPE = SERVICE;`
            : workloadProvider === "GCP"
              ? `CREATE USER ${user}
  WORKLOAD_IDENTITY = (
    TYPE = GCP
    SUBJECT = '<service_account_unique_id>'
  )
  TYPE = SERVICE;`
              : `CREATE USER ${user} TYPE = SERVICE;
ALTER USER ${user} SET WORKLOAD_IDENTITY = (
  TYPE = AWS
  ARN = 'arn:aws:iam::<account-id>:role/<growthbook-task-role>'
);`;
        createUserCode = `CREATE ROLE ${role};
${identityBinding}
GRANT ROLE ${role} TO USER ${user};
${readGrants}`;
      } else {
        const authLine =
          authMethod === "password"
            ? "PASSWORD = '<password>'"
            : "RSA_PUBLIC_KEY = '<from rsa_key.pub>'";
        createUserCode = `CREATE ROLE ${role};
CREATE USER ${user}
  DEFAULT_ROLE = ${role}
  ${authLine};
GRANT ROLE ${role} TO USER ${user};
${readGrants}`;
      }

      if (isEventForwarder && authMethod !== "workload-identity") {
        createUserCode += `

-- Write access for Event Forwarder
GRANT CREATE SCHEMA ON DATABASE ${database} TO ROLE ${role};
CREATE SCHEMA ${database}.${efSchema};
GRANT USAGE ON SCHEMA ${database}.${efSchema} TO ROLE ${role};
GRANT CREATE TABLE ON SCHEMA ${database}.${efSchema} TO ROLE ${role};
GRANT INSERT ON ALL TABLES IN SCHEMA ${database}.${efSchema} TO ROLE ${role};
GRANT INSERT ON FUTURE TABLES IN SCHEMA ${database}.${efSchema} TO ROLE ${role};`;
      }

      const userStepDescription =
        authMethod === "workload-identity"
          ? isEventForwarder
            ? "Self-hosted only. The Event Forwarder requires key-pair authentication."
            : "Self-hosted only. Run as ACCOUNTADMIN."
          : isEventForwarder
            ? "Run as ACCOUNTADMIN. The Event Forwarder requires key-pair authentication."
            : "Run as ACCOUNTADMIN.";

      return [
        {
          title: "Create a user and grant access",
          description: userStepDescription,
          code: createUserCode,
          preserveCase: preserveUserSqlCase,
        },
        {
          title: "Allow network access",
          description: isEventForwarder
            ? "If a network policy restricts IPs, allow GrowthBook Cloud and the Event Forwarder addresses in the {link}."
            : "Only if a network policy restricts IPs.",
          code: isEventForwarder
            ? undefined
            : `CREATE NETWORK POLICY GROWTHBOOK_POLICY
  ALLOWED_IP_LIST = ('${CLOUD_EGRESS_IP}');
ALTER USER ${user}
  SET NETWORK_POLICY = GROWTHBOOK_POLICY;`,
          docLink: isEventForwarder
            ? { section: "ipAddresses", label: "IP addresses guide" }
            : undefined,
        },
        {
          title: "Enter credentials and test",
          description:
            authMethod === "workload-identity"
              ? "Select Workload Identity Federation and the cloud GrowthBook runs on, then test."
              : "Enter the account, warehouse, database, and credentials, then test.",
        },
      ];
    }

    case "databricks": {
      const catalog = field(p, "catalog", "main");
      // Match DatabricksForm: connections saved before authType existed are PAT.
      const authType = typeof p.authType === "string" ? p.authType : "pat";
      const usingOauth = isEventForwarder || authType === "oauth-m2m";
      const principal = "`<service-principal-application-id>`";

      let grantCode = `-- Read access for analysis
GRANT USE CATALOG ON CATALOG ${catalog}
  TO ${principal};
GRANT USE SCHEMA, SELECT ON SCHEMA ${catalog}.<schema>
  TO ${principal};`;

      if (isEventForwarder) {
        grantCode += `

-- Write access for Event Forwarder (Unity Catalog)
GRANT USE SCHEMA, CREATE TABLE
  ON SCHEMA ${catalog}.growthbook
  TO ${principal};`;
      }

      const steps: SetupInstructionStep[] = [
        {
          title: "Find connection details",
          description: "Copy the server hostname, port, and HTTP path.",
        },
        usingOauth
          ? {
              title: "Create a service principal",
              description: isEventForwarder
                ? "Copy the Client ID and OAuth secret. Required for the Event Forwarder."
                : "Copy the Client ID and OAuth secret.",
            }
          : {
              title: "Create a personal access token",
              description:
                "Create a token for a user or service principal. OAuth is recommended.",
            },
        {
          title: "Grant access",
          description: isEventForwarder
            ? "Replace the application ID and schema. Unity Catalog only. Use a schema such as growthbook for Event Forwarder tables."
            : "Replace the application ID and schema.",
          code: grantCode,
          preserveCase: true,
        },
      ];

      steps.push({
        title: "Allow network access",
        description: isEventForwarder
          ? "If IP access lists are on, allow GrowthBook Cloud and the Event Forwarder addresses in the {link}."
          : "Only if IP access lists are on.",
        code: isEventForwarder
          ? undefined
          : `# GrowthBook Cloud egress IP
${CLOUD_EGRESS_IP}/32`,
        docLink: isEventForwarder
          ? { section: "ipAddresses", label: "IP addresses guide" }
          : undefined,
      });

      steps.push({
        title: "Enter credentials and test",
        description: usingOauth
          ? "Enter the hostname, port, HTTP path, Client ID, and OAuth secret, then test."
          : "Enter the hostname, port, HTTP path, and token, then test.",
      });

      return steps;
    }

    case "redshift": {
      const user = field(p, "user", "growthbook_user");
      const schema = field(p, "defaultSchema", "public");
      const port = field(p, "port", "5439");

      return [
        {
          title: "Find connection details",
          description:
            "Copy the workgroup endpoint. It splits into host, port, and database.",
        },
        {
          title: "Configure security settings",
          description: `Turn on publicly accessible. Allow inbound TCP ${port} from this IP.`,
          code: `# Security group inbound rule
Protocol: TCP
Port: ${port}
Source: ${CLOUD_EGRESS_IP}/32`,
        },
        {
          title: "Create a read-only user",
          description: "Run in the query editor.",
          code: `CREATE USER ${user} WITH PASSWORD 'securepassword';
GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO ${user};
ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema}
  GRANT SELECT ON TABLES TO ${user};`,
        },
        {
          title: "Enter credentials and test",
          description:
            "Enter the host, port, database, and user, then test. Require SSL is recommended.",
        },
      ];
    }

    case "athena":
      return [
        {
          title: "Create an IAM user",
          description:
            "Start from AWSQuicksightAthenaAccess, then limit S3 read to your event buckets.",
          code: `{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:Get*",
        "s3:List*",
        "s3-object-lambda:Get*",
        "s3-object-lambda:List*"
      ],
      "Resource": [
        "arn:aws:s3:::YOUR_BUCKET*"
      ]
    }
  ]
}`,
          preserveCase: true,
        },
        {
          title: "Create an access key",
          description:
            "IAM → Security credentials → Create access key → Third-party service.",
        },
        {
          title: "Enter credentials and test",
          description:
            "Enter the keys, region, workgroup, catalog, database, and S3 results URL, then test. Self-hosted GrowthBook can use auto-discovery or an IAM role.",
        },
      ];

    case "presto":
      return [
        {
          title: "Choose engine and auth",
          description:
            "Presto or Trino. Basic, Custom, or None. None sets the user to growthbook and is not recommended on GrowthBook Cloud.",
        },
        {
          title: "Enter connection details",
          description:
            "Host includes http:// or https://. Port defaults to 8080. Set catalog and schema. Source defaults to GrowthBook. Then test.",
        },
      ];

    case "clickhouse":
      return [
        {
          title: "Create read-only credentials",
          description:
            "In ClickHouse Cloud, copy the connection string. Use read-only credentials.",
        },
        {
          title: "Allow network access",
          description: "If ClickHouse is behind a firewall, allow this IP.",
          code: `# GrowthBook Cloud egress IP
${CLOUD_EGRESS_IP}/32`,
        },
        {
          title: "Enter credentials and test",
          description: TEST_CONNECTION,
        },
      ];

    case "postgres": {
      const cloud = isCloud();
      return postgresLikeSteps(p, {
        userFallback: "growthbook",
        databaseFallback: "your_database",
        schemaFallback: "public",
        portFallback: "5432",
        includeEgressIp: cloud,
        createUserSql: (user, database, schema) =>
          `CREATE USER ${user} WITH PASSWORD 'use-a-strong-password';
GRANT CONNECT ON DATABASE ${database} TO ${user};
GRANT USAGE ON SCHEMA ${schema} TO ${user};
GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO ${user};
ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema}
  GRANT SELECT ON TABLES TO ${user};`,
        networkDescription: () =>
          cloud
            ? "If a firewall, security group, or pg_hba.conf is in front of Postgres, allow this IP."
            : "GrowthBook runs in Docker. Set the host to host.docker.internal instead of localhost.",
      });
    }

    case "mysql": {
      const user = field(p, "user", "growthbook");
      const database = field(p, "database", "your_database");
      const port = field(p, "port", "3306");
      return [
        {
          title: "Create a read-only user",
          description:
            "Grant SELECT on the database. Restrict the host from '%' when you can.",
          code: `CREATE USER '${user}'@'%' IDENTIFIED BY 'use-a-strong-password';
GRANT SELECT ON ${database}.* TO '${user}'@'%';
FLUSH PRIVILEGES;`,
        },
        {
          title: "Allow network access",
          description: `Allow port ${port} from this IP. On Docker, use host.docker.internal instead of localhost.`,
          code: `# GrowthBook Cloud egress IP
${CLOUD_EGRESS_IP}/32`,
        },
        {
          title: "Enter credentials and test",
          description: TEST_CONNECTION,
        },
      ];
    }

    case "mssql": {
      const user = field(p, "user", "growthbook");
      const schema = field(p, "defaultSchema", "dbo");
      const port = field(p, "port", "1433");
      return [
        {
          title: "Create a read-only login",
          description: "Grant SELECT on the schema.",
          code: `CREATE LOGIN ${user} WITH PASSWORD = 'use-a-strong-password';
CREATE USER ${user} FOR LOGIN ${user};
GRANT SELECT ON SCHEMA::${schema} TO ${user};`,
        },
        {
          title: "Allow network access",
          description: `Allow port ${port} from this IP. On Docker, use host.docker.internal as the server instead of localhost.`,
          code: `# GrowthBook Cloud egress IP
${CLOUD_EGRESS_IP}/32`,
        },
        {
          title: "Enter credentials and test",
          description:
            "Enter the server, port, database, and login, then test. Encryption defaults to on.",
        },
      ];
    }

    case "vertica":
      return [
        {
          title: "Create a dedicated user",
          description:
            "Optional. Grant SELECT, and allow HOST password auth from GrowthBook Cloud.",
        },
        {
          title: "Allow network access",
          description: "If Vertica is firewalled, allow this IP.",
          code: `# GrowthBook Cloud egress IP
${CLOUD_EGRESS_IP}/32`,
        },
        {
          title: "Enter credentials and test",
          description: TEST_CONNECTION,
        },
      ];

    case "adobe_experience_platform_query_service":
      return [
        {
          title: "Generate a non-expiring credential",
          description:
            "Queries → Credentials → Non-expiring Credentials → Generate credentials. Store the JSON. Adobe does not keep a copy.",
        },
        {
          title: "Map fields from the credential",
          description:
            "Host: Expiring Credentials. Port: 80 or 5432. Database: like prod:all. Username: includes @AdobeOrg. Technical account ID and credential: from the JSON.",
        },
        {
          title: "Enter credentials and test",
          description: TEST_CONNECTION,
        },
      ];

    case "mixpanel":
      return [
        {
          title: "Use a warehouse export",
          description:
            "Direct Mixpanel is no longer supported. Export to a warehouse, then connect that. See the {link}.",
          docLink: { section: "mixpanel", label: "Mixpanel guide" },
        },
      ];

    case "google_analytics":
      return [
        {
          title: "Connect GA4 through BigQuery",
          description:
            "GrowthBook reads GA4 from BigQuery. Steps are in the {link}.",
          docLink: { section: "google_analytics", label: "GA4 guide" },
        },
      ];

    case "growthbook_clickhouse":
      return [
        {
          title: "Provision the Managed Warehouse",
          description:
            "Create the Managed Warehouse. There are no credentials to enter. See the {link}.",
          docLink: {
            section: "growthbook_clickhouse",
            label: "Managed Warehouse guide",
          },
        },
      ];
  }
}
