import { DataSourceParams, DataSourceType } from "shared/types/datasource";

export type ConnectSetupKind = "custom" | "event_forwarder";

export type SetupInstructionStep = {
  title: string;
  description: string;
  code?: string;
  /** When true, skip the all-caps transform (e.g. JSON policies). */
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

function postgresLikeSteps(
  params: ParamsBag,
  setup: ConnectSetupKind,
  opts: {
    userFallback: string;
    databaseFallback: string;
    schemaFallback: string;
    portFallback: string;
    createUserSql: (user: string, database: string, schema: string) => string;
    networkDescription: (port: string) => string;
  },
): SetupInstructionStep[] {
  const user = field(params, "user", opts.userFallback);
  const database = field(params, "database", opts.databaseFallback);
  const schema = field(params, "defaultSchema", opts.schemaFallback);
  const port = field(params, "port", opts.portFallback);

  const steps: SetupInstructionStep[] = [
    {
      title: "Create a read-only user",
      description:
        "Grant SELECT only on the schemas that hold experiment assignment and metric events.",
      code: opts.createUserSql(user, database, schema || "public"),
    },
    {
      title: "Allow network access",
      description: opts.networkDescription(port),
      code: `# GrowthBook Cloud egress IP
${CLOUD_EGRESS_IP}/32`,
    },
    {
      title: "Enter credentials and test",
      description:
        "Fill in the connection fields on the left, then run the connection test before saving.",
    },
  ];

  if (setup !== "event_forwarder") return steps;

  return withEventForwarderWrite(steps, {
    title: "Grant write access for Event Forwarder",
    description:
      "Event Forwarder needs a destination schema where GrowthBook can create tables and write events.",
    code: `CREATE SCHEMA ${schema || "growthbook_events"} AUTHORIZATION ${user};
GRANT ALL ON SCHEMA ${schema || "growthbook_events"} TO ${user};`,
  });
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
      const dataset = field(p, "defaultDataset", "YOUR_DATASET");
      const location = field(p, "location", "US");
      const sa = `growthbook@${projectId}.iam.gserviceaccount.com`;

      const steps: SetupInstructionStep[] = [
        {
          title: "Create a service account",
          description:
            "In Google Cloud IAM, create a service account and grant BigQuery Job User. Then download a JSON key.",
          code: `gcloud iam service-accounts create growthbook \\
  --project=${projectId}
gcloud projects add-iam-policy-binding ${projectId} \\
  --member="serviceAccount:${sa}" \\
  --role="roles/bigquery.jobUser"
gcloud iam service-accounts keys create \\
  growthbook-sa.json \\
  --iam-account=${sa}`,
        },
        {
          title: "Grant dataset access",
          description:
            "Give the service account BigQuery Data Viewer and Metadata Viewer on the datasets you analyze.",
          code: `-- Read access for analysis
GRANT \`roles/bigquery.dataViewer\`
  ON SCHEMA \`${projectId}.${dataset}\`
  TO "serviceAccount:${sa}";
GRANT \`roles/bigquery.metadataViewer\`
  ON SCHEMA \`${projectId}.${dataset}\`
  TO "serviceAccount:${sa}";`,
        },
        {
          title: "Enter credentials and test",
          description:
            "Upload the service account JSON key on the left, then run the connection test before saving.",
        },
      ];

      if (!isEventForwarder) return steps;

      return withEventForwarderWrite(steps, {
        title: "Grant write access for Event Forwarder",
        description:
          "Event Forwarder needs BigQuery Data Editor on the destination dataset so it can create and write event tables.",
        code: `CREATE SCHEMA \`${projectId}.growthbook_events\`
  OPTIONS (location = "${location}");
GRANT \`roles/bigquery.dataEditor\`
  ON SCHEMA \`${projectId}.growthbook_events\`
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
      const authLine =
        authMethod === "password"
          ? "PASSWORD = '<password>'"
          : "RSA_PUBLIC_KEY = '<from rsa_key.pub>'";

      let createUserCode = `CREATE ROLE ${role};
CREATE USER ${user}
  DEFAULT_ROLE = ${role}
  ${authLine};
GRANT ROLE ${role} TO USER ${user};
GRANT USAGE ON WAREHOUSE ${warehouse}
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

      if (isEventForwarder) {
        createUserCode += `

-- Write access for Event Forwarder
CREATE SCHEMA ${database}.${efSchema};
GRANT USAGE ON DATABASE ${database} TO ROLE ${role};
GRANT USAGE ON SCHEMA ${database}.${efSchema} TO ROLE ${role};
GRANT CREATE TABLE ON SCHEMA ${database}.${efSchema} TO ROLE ${role};
GRANT INSERT ON ALL TABLES IN SCHEMA ${database}.${efSchema} TO ROLE ${role};`;
      }

      return [
        {
          title: "Create a user and grant access",
          description:
            "Run this as a role that can create users, like ACCOUNTADMIN. Event Forwarder requires key-pair auth.",
          code: createUserCode,
        },
        {
          title: "Allow network access",
          description:
            "Only needed if your account restricts IP addresses with a network policy.",
          code: `CREATE NETWORK POLICY GROWTHBOOK_POLICY
  ALLOWED_IP_LIST = ('${CLOUD_EGRESS_IP}');
ALTER USER ${user}
  SET NETWORK_POLICY = GROWTHBOOK_POLICY;`,
        },
        {
          title: "Enter credentials and test",
          description:
            "Fill in the account, warehouse, database, and credentials on the left, then run the connection test.",
        },
      ];
    }

    case "databricks": {
      const catalog = field(p, "catalog", "main");
      const schema = field(p, "schema", "default");
      const principal = "growthbook";

      let grantCode = `-- Read access for analysis
GRANT USE CATALOG ON CATALOG ${catalog}
  TO \`${principal}\`;
GRANT USE SCHEMA, SELECT ON SCHEMA ${catalog}.${schema}
  TO \`${principal}\`;`;

      if (isEventForwarder) {
        grantCode += `

-- Write access for Event Forwarder (Unity Catalog)
GRANT USE SCHEMA, CREATE TABLE
  ON SCHEMA ${catalog}.growthbook_events
  TO \`${principal}\`;`;
      }

      return [
        {
          title: "Create a service principal",
          description:
            "In Workspace settings, create a service principal and generate an OAuth secret (Client ID and Secret). OAuth is required for Event Forwarder.",
        },
        {
          title: "Grant access",
          description:
            "Run in a SQL editor as a catalog admin. Use the service principal application ID.",
          code: grantCode,
        },
        {
          title: "Allow network access",
          description: `Only needed if your workspace uses IP access lists. Allow ${CLOUD_EGRESS_IP}/32.`,
        },
        {
          title: "Enter credentials and test",
          description:
            "Enter the server hostname, HTTP path, and OAuth credentials on the left, then run the connection test.",
        },
      ];
    }

    case "redshift": {
      const user = field(p, "user", "growthbook_user");
      const schema = field(p, "defaultSchema", "public");
      const port = field(p, "port", "5439");

      return [
        {
          title: "Find connection details",
          description:
            "In Amazon Redshift Serverless, open your workgroup and copy the endpoint. It splits into host, port, and database name.",
        },
        {
          title: "Configure security settings",
          description: `Turn on publicly accessible if needed, then allow inbound TCP ${port} from GrowthBook Cloud's egress IP.`,
          code: `# Security group inbound rule
Protocol: TCP
Port: ${port}
Source: ${CLOUD_EGRESS_IP}/32`,
        },
        {
          title: "Create a read-only user",
          description:
            "Run in the Query Editor. Replace the schema if your events are not in public.",
          code: `CREATE USER ${user} WITH PASSWORD 'securepassword';
GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO ${user};
ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema}
  GRANT SELECT ON TABLES TO ${user};`,
        },
        {
          title: "Enter credentials and test",
          description:
            "Fill in host, port, database, and the read-only user on the left, then run the connection test.",
        },
      ];
    }

    case "athena":
      return [
        {
          title: "Create an IAM user",
          description:
            "Create a read-only IAM user. Start from AWSQuicksightAthenaAccess, then narrow S3 read access to the buckets that hold your event data.",
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
            "In IAM → Security credentials → Create access key → Third-party service. Copy the Access Key and Secret Access Key.",
        },
        {
          title: "Enter credentials and test",
          description:
            "Enter the access keys, region, workgroup, catalog, database, and S3 results URL on the left, then run the connection test.",
        },
      ];

    case "presto":
      return [
        {
          title: "Choose engine and auth",
          description:
            "Select Presto or Trino, then Basic auth (username and password), Custom auth (Authorization header), or None for trusted networks.",
        },
        {
          title: "Enter connection details",
          description:
            "Host must include http:// or https://. Set the default catalog and schema used in generated queries.",
        },
        {
          title: "Enter credentials and test",
          description:
            "Fill in the fields on the left, then run the connection test before saving.",
        },
      ];

    case "clickhouse":
      return [
        {
          title: "Create read-only credentials",
          description:
            "In ClickHouse Cloud, copy the connection string and create credentials with read-only access for GrowthBook.",
        },
        {
          title: "Allow network access",
          description:
            "Only needed if ClickHouse is behind a firewall. Allow GrowthBook Cloud's egress IP.",
          code: `# GrowthBook Cloud egress IP
${CLOUD_EGRESS_IP}/32`,
        },
        {
          title: "Enter credentials and test",
          description:
            "Fill in the connection fields on the left, then run the connection test before saving.",
        },
      ];

    case "postgres":
      return postgresLikeSteps(p, setup, {
        userFallback: "growthbook",
        databaseFallback: "your_database",
        schemaFallback: "public",
        portFallback: "5432",
        createUserSql: (user, database, schema) =>
          `CREATE USER ${user} WITH PASSWORD 'use-a-strong-password';
GRANT CONNECT ON DATABASE ${database} TO ${user};
GRANT USAGE ON SCHEMA ${schema} TO ${user};
GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO ${user};
ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema}
  GRANT SELECT ON TABLES TO ${user};`,
        networkDescription: (port) =>
          `Allow inbound traffic from GrowthBook Cloud on port ${port}. Update your firewall, security group, and pg_hba.conf as needed.`,
      });

    case "mysql": {
      const user = field(p, "user", "growthbook");
      const database = field(p, "database", "your_database");
      const port = field(p, "port", "3306");
      return [
        {
          title: "Create a read-only user",
          description:
            "Grant SELECT on the database that holds assignment and metric events. Tighten the host from '%' when you can.",
          code: `CREATE USER '${user}'@'%' IDENTIFIED BY 'use-a-strong-password';
GRANT SELECT ON ${database}.* TO '${user}'@'%';
FLUSH PRIVILEGES;`,
        },
        {
          title: "Allow network access",
          description: `Allow inbound traffic from GrowthBook Cloud on port ${port}.`,
          code: `# GrowthBook Cloud egress IP
${CLOUD_EGRESS_IP}/32`,
        },
        {
          title: "Enter credentials and test",
          description:
            "Fill in the connection fields on the left, then run the connection test before saving.",
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
          description:
            "Grant SELECT on the schema that holds assignment and metric events. Replace dbo if needed.",
          code: `CREATE LOGIN ${user} WITH PASSWORD = 'use-a-strong-password';
CREATE USER ${user} FOR LOGIN ${user};
GRANT SELECT ON SCHEMA::${schema} TO ${user};`,
        },
        {
          title: "Allow network access",
          description: `Allow inbound traffic from GrowthBook Cloud on port ${port}.`,
          code: `# GrowthBook Cloud egress IP
${CLOUD_EGRESS_IP}/32`,
        },
        {
          title: "Enter credentials and test",
          description:
            "Fill in server, port, database, and the SQL login on the left, then run the connection test.",
        },
      ];
    }

    case "vertica":
      return [
        {
          title: "Create a dedicated user",
          description:
            "Recommended. Grant SELECT on the schema with assignment and metric data, and allow HOST authentication with the password method from GrowthBook Cloud.",
        },
        {
          title: "Allow network access",
          description: `Allow inbound traffic from GrowthBook Cloud (${CLOUD_EGRESS_IP}/32) if Vertica is firewalled.`,
          code: `# GrowthBook Cloud egress IP
${CLOUD_EGRESS_IP}/32`,
        },
        {
          title: "Enter credentials and test",
          description:
            "Fill in host, port, database, and credentials on the left, then run the connection test.",
        },
      ];

    case "adobe_experience_platform_query_service":
      return [
        {
          title: "Generate a non-expiring credential",
          description:
            "In Adobe Experience Platform: Queries → Credentials → Non-expiring Credentials → Generate credentials. Download and store the configuration JSON; Adobe does not keep a copy.",
        },
        {
          title: "Map fields from the credential",
          description:
            "Host comes from Expiring Credentials (same host for non-expiring). Port is usually 80 (or 5432). Database looks like prod:all. Username includes the @AdobeOrg suffix. Technical account ID and Credential come from the JSON.",
        },
        {
          title: "Enter credentials and test",
          description:
            "Fill in the fields on the left from the Adobe configuration JSON, then run the connection test.",
        },
      ];

    case "mixpanel":
    case "google_analytics":
    case "growthbook_clickhouse":
      return [
        {
          title: "Enter credentials and test",
          description:
            "Fill in the connection fields on the left, then run the connection test before saving.",
        },
      ];
  }
}
