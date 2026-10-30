import {
  DataSourceInterfaceWithParams,
  DataSourceParams,
  DataSourceType,
} from "shared/types/datasource";
import type { DataRegion } from "shared/util";
import { DocSection } from "@/components/docSections";
import type { EventForwarderDestination } from "./EventForwarderDestinationFields";
import { SnowflakeKeyPair } from "./generateSnowflakeKeyPair";

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
  /**
   * What the Copy button puts on the clipboard when it differs from `code`.
   * Passwords are masked in `code` so they never show on screen; this holds
   * the runnable version.
   */
  codeToCopy?: string;
  /** Shown under the code block. Backticks render as inline code. */
  codeNote?: string;
};

/** The form values for one warehouse type, all optional while the user types. */
type ParamsFor<T extends DataSourceType> = Partial<
  Extract<DataSourceInterfaceWithParams, { type: T }>["params"]
>;

type StepContext<T extends DataSourceType = DataSourceType> = {
  isEventForwarder: boolean;
  /**
   * Data regions the Event Forwarder may write from. A single entry when the
   * region is already chosen (editing); otherwise every region the org can
   * pick, since the choice happens after the connection is created.
   */
  eventForwarderRegions: DataRegion[];
  /**
   * The dataset/schema/catalog-schema chosen in the Event Destination fields.
   * Null while it is still unknown, so write-access SQL falls back to the
   * connection's own defaults rather than guessing.
   */
  eventForwarderDestination: EventForwarderDestination | null;
  /** Editing a saved connection. Affects defaults such as Snowflake's auth method. */
  existing: boolean;
  /**
   * The saved connection's params when editing, otherwise null. Builders diff
   * the form against this: same username means the warehouse user exists and
   * gets ALTER plus grants for whatever changed; a new username gets CREATE.
   */
  saved: ParamsFor<T> | null;
  /** GrowthBook Cloud reaches the warehouse from a fixed IP; self-hosted runs in Docker. */
  cloud: boolean;
  /** Key pair GrowthBook generated on request. Only its public half is ever shown. */
  snowflakeKeyPair: SnowflakeKeyPair | null;
};

type StepBuilder<T extends DataSourceType> = (
  params: ParamsFor<T>,
  ctx: StepContext<T>,
) => SetupInstructionStep[];

const CLOUD_EGRESS_IP = "52.70.79.40";
// Event Forwarder ingestors write from the egress IP, plus this one when the
// eu-west-1 region is selected.
const EU_INGESTOR_IP = "54.74.233.97";
const EU_INGESTOR_NOTE = `\`${EU_INGESTOR_IP}\` is only needed if you choose the eu-west-1 data region when setting up the Event Forwarder.`;

// Every field the SQL above depends on is already in the form by now, so the
// last step is only the test.
const TEST_STEP: SetupInstructionStep = {
  title: "Test the connection",
  description: "Run the connection test, then save.",
};

const DOCKER_HOST_NOTE =
  "GrowthBook runs in Docker. Set the host to host.docker.internal instead of localhost.";

const PASSWORD_PLACEHOLDER = "'<password>'";
const PASSWORD_MASK = "'••••••••'";
const PUBLIC_KEY_PLACEHOLDER = "'<contents of rsa_key.pub>'";

/**
 * How a warehouse reads a single-quoted string literal.
 * - "quote-only": only `'` is special (Postgres with the default
 *   standard_conforming_strings, MSSQL).
 * - "backslash": `\` is also an escape character (MySQL by default, Snowflake,
 *   and Redshift, which keeps PostgreSQL 8.0 escape processing).
 */
type SqlDialect = "quote-only" | "backslash";

/** A form value as a trimmed string, or `fallback` when blank. Ports arrive as numbers. */
function field<P>(params: P, key: keyof P, fallback: string): string {
  const value = params[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

/**
 * Whether a form value differs from the saved connection, compared the way
 * the SQL renders them so a blank saved schema equals a typed "public".
 */
function changed<P>(
  params: P,
  saved: P | null,
  key: keyof P,
  fallback: string,
): boolean {
  return (
    saved !== null &&
    field(saved, key, fallback) !== field(params, key, fallback)
  );
}

/** The username field, whichever name the warehouse uses for it. */
function userNameOf(params: {
  user?: string;
  username?: string;
}): string | undefined {
  const name = params.user ?? params.username;
  return typeof name === "string" ? name.trim() || undefined : undefined;
}

/**
 * Editing, and the username matches the saved connection, so the warehouse
 * user already exists. Blank or renamed means a new user.
 */
function hasSavedUser<P extends { user?: string; username?: string }>(
  params: P,
  saved: P | null,
): boolean {
  const name = userNameOf(params);
  return saved !== null && name !== undefined && userNameOf(saved) === name;
}

/**
 * Postgres folds unquoted identifiers to lowercase, but the connection sends
 * the form value as typed. Quoting keeps the created role, database, and
 * schema identical to what the form will send.
 */
function pgIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function sqlStringLiteral(value: string, dialect: SqlDialect): string {
  let escaped = value.replace(/'/g, "''");
  if (dialect === "backslash") {
    escaped = escaped.replace(/\\/g, "\\\\");
  }
  return `'${escaped}'`;
}

/**
 * The credential a user statement sets, in two forms: `display` for the
 * screen and `copy` for the clipboard. A password in the form shows as a mask
 * with the exact value on Copy, so the query runs without the secret ever
 * being visible. A public key or identity binding is the same in both.
 */
type CredentialLiteral = {
  /** The form holds a real value, as opposed to a placeholder. */
  present: boolean;
  display: string;
  copy: string;
  note?: string;
};

function passwordFor(
  params: { password?: string },
  dialect: SqlDialect,
): CredentialLiteral {
  const password = params.password ? params.password : null;
  if (password === null) {
    return {
      present: false,
      display: PASSWORD_PLACEHOLDER,
      copy: PASSWORD_PLACEHOLDER,
      note: "Enter a password in the form to include it here.",
    };
  }
  return {
    present: true,
    display: PASSWORD_MASK,
    copy: sqlStringLiteral(password, dialect),
    note: "The password is hidden here. Copy includes the value from the Password field.",
  };
}

/** Renders a code block once for the screen and once for the clipboard. */
function withCredential(
  credential: CredentialLiteral,
  render: (literal: string) => string,
): Pick<SetupInstructionStep, "code" | "codeToCopy"> {
  const code = render(credential.display);
  return credential.display === credential.copy
    ? { code }
    : { code, codeToCopy: render(credential.copy) };
}

/** A grant block the update step adds because the field it depends on changed. */
type GrantChange = { label: string; sql: string };

function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/**
 * The user step when editing a connection whose user already exists. Grants
 * are only repeated for fields they depend on that changed since the save.
 * The credential ALTER appears when the form holds a new value, or on its
 * own with a placeholder when nothing else changed so the step stays
 * actionable.
 */
function updateUserStep({
  credential,
  alter,
  changes,
  rotateOnly,
}: {
  credential: CredentialLiteral;
  /** Renders the ALTER for the credential literal. */
  alter: (literal: string) => string;
  changes: GrantChange[];
  /** Description when no grant-related field changed. */
  rotateOnly: string;
}): SetupInstructionStep {
  const title = "Update the user";
  if (changes.length === 0) {
    return {
      title,
      description: rotateOnly,
      ...withCredential(credential, alter),
      codeNote: credential.note,
    };
  }

  const labels = [...new Set(changes.map((c) => c.label))];
  const what = `The ${listOf(labels)} changed.`;
  const grants = changes.map((c) => c.sql).join("\n");
  const target = labels.length > 1 ? "new ones" : "new one";
  if (!credential.present) {
    return {
      title,
      description: `${what} Grant access on the ${target}.`,
      code: grants,
      codeNote: "Enter new credentials in the form to rotate them as well.",
    };
  }
  return {
    title,
    description: `${what} Rotate the credentials and grant access on the ${target}.`,
    ...withCredential(credential, (literal) => `${alter(literal)}\n${grants}`),
    codeNote: credential.note,
  };
}

function cidrList(ips: string[]): string {
  return ips.map((ip) => `${ip}/32`).join("\n");
}

/**
 * The "Allow network access" step. Lists the Cloud egress IP, plus the EU
 * ingestor when the Event Forwarder may write from eu-west-1. The note only
 * appears while the region is still the user's to choose. `code` formats the
 * list for the warehouse; the default is one CIDR per line.
 */
function networkAccessStep({
  description,
  ctx: { isEventForwarder, eventForwarderRegions },
  code = cidrList,
}: {
  description: string;
  ctx: StepContext;
  code?: (ips: string[]) => string;
}): SetupInstructionStep {
  const mayUseEu =
    isEventForwarder && eventForwarderRegions.includes("eu-west-1");
  const ips = mayUseEu ? [CLOUD_EGRESS_IP, EU_INGESTOR_IP] : [CLOUD_EGRESS_IP];
  return {
    title: "Allow network access",
    description,
    code: code(ips),
    codeNote:
      mayUseEu && eventForwarderRegions.length > 1
        ? EU_INGESTOR_NOTE
        : undefined,
  };
}

/**
 * Self-hosted GrowthBook has no fixed IP to allow, so the network step
 * becomes Docker host guidance instead.
 */
function networkAccessOrDockerStep(
  ctx: StepContext,
  cloudDescription: string,
  dockerDescription = DOCKER_HOST_NOTE,
): SetupInstructionStep {
  return ctx.cloud
    ? networkAccessStep({ description: cloudDescription, ctx })
    : { title: "Allow network access", description: dockerDescription };
}

const bigquerySteps: StepBuilder<"bigquery"> = (
  p,
  { isEventForwarder, eventForwarderDestination },
) => {
  const projectId = field(p, "projectId", "YOUR_PROJECT");
  const sa = `growthbook@${projectId}.iam.gserviceaccount.com`;
  const member = `--member="serviceAccount:${sa}"`;
  // GrowthBook queries `defaultProject`, which can differ from the service
  // account's own home project (`projectId`). The write-access dataset must
  // live there too, or the grant lands in the wrong project.
  const destinationProjectId = field(p, "defaultProject", projectId);
  // Falls back to the form's own default only when the destination isn't
  // known yet; once chosen, the grant must match exactly or the write test fails.
  const efDataset =
    eventForwarderDestination?.location?.trim() || "growthbook_events";

  const steps: SetupInstructionStep[] = [
    {
      title: "Create a service account",
      description:
        "Grant BigQuery Data Viewer, Metadata Viewer, and Job User. Console steps are in the {link}.",
      docLink: { section: "bigquery", label: "BigQuery guide" },
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
      description:
        "In the console: Manage keys → Add key → JSON. Upload it in the form.",
      code: `gcloud iam service-accounts keys create \\
  growthbook-sa.json \\
  --iam-account=${sa}`,
    },
  ];

  if (isEventForwarder) {
    steps.push({
      title: "Grant write access for Event Forwarder",
      description:
        "Create the dataset in the same region as your event data (BigQuery cannot join across regions), then grant BigQuery Data Editor on it.",
      code: `CREATE SCHEMA \`${destinationProjectId}\`.${efDataset}
  OPTIONS (location = "<region>");
GRANT \`roles/bigquery.dataEditor\`
  ON SCHEMA \`${destinationProjectId}\`.${efDataset}
  TO "serviceAccount:${sa}";`,
    });
  }

  steps.push(TEST_STEP);

  return steps;
};

const SNOWFLAKE_FALLBACKS = {
  role: "GROWTHBOOK_ROLE",
  warehouse: "COMPUTE_WH",
  database: "ANALYTICS",
  schema: "GROWTHBOOK_EVENTS",
} as const;

const snowflakeSteps: StepBuilder<"snowflake"> = (p, ctx) => {
  const {
    isEventForwarder,
    existing,
    saved,
    snowflakeKeyPair,
    eventForwarderDestination,
  } = ctx;
  const role = field(p, "role", SNOWFLAKE_FALLBACKS.role);
  const user = field(p, "username", "GROWTHBOOK");
  const warehouse = field(p, "warehouse", SNOWFLAKE_FALLBACKS.warehouse);
  const database = field(p, "database", SNOWFLAKE_FALLBACKS.database);
  // The Event Forwarder writes to a destination schema chosen separately from
  // the connection's own (read) schema — prefer it once known, and otherwise
  // fall back to the connection schema field the way this used to work.
  const efSchema =
    eventForwarderDestination?.location?.trim() ||
    field(p, "schema", SNOWFLAKE_FALLBACKS.schema);
  // Match SnowflakeForm: connections saved before authMethod existed used
  // a password; new connections default to key-pair.
  const authMethod = p.authMethod ?? (existing ? "password" : "key-pair");
  const workloadProvider = p.workloadIdentityProvider ?? "AWS";
  const password = passwordFor(p, "backslash");
  // Only show the generated public key while its private half is still in
  // the form; uploading a different key file replaces it.
  const usingGeneratedKey =
    snowflakeKeyPair !== null &&
    !!p.privateKey &&
    p.privateKey === snowflakeKeyPair.privateKey;
  const publicKeyLiteral = usingGeneratedKey
    ? `'${snowflakeKeyPair.publicKey}'`
    : PUBLIC_KEY_PLACEHOLDER;
  const publicKey: CredentialLiteral = {
    present: !!p.privateKey,
    display: publicKeyLiteral,
    copy: publicKeyLiteral,
    note: p.privateKey
      ? undefined
      : "Add or generate a private key before copying the query.",
  };

  const wifBinding =
    workloadProvider === "AZURE"
      ? `(
    TYPE = AZURE
    ISSUER = 'https://login.microsoftonline.com/<tenant_id>/v2.0'
    SUBJECT = '<managed_identity_object_id>'
  )`
      : workloadProvider === "GCP"
        ? `(
    TYPE = GCP
    SUBJECT = '<service_account_unique_id>'
  )`
        : `(
    TYPE = AWS
    ARN = 'arn:aws:iam::<account-id>:role/<growthbook-task-role>'
  )`;

  const warehouseGrant = `GRANT USAGE ON WAREHOUSE ${warehouse}
  TO ROLE ${role};`;
  const databaseGrants = `GRANT USAGE ON DATABASE ${database}
  TO ROLE ${role};
GRANT USAGE ON ALL SCHEMAS
  IN DATABASE ${database}
  TO ROLE ${role};
GRANT SELECT ON ALL TABLES
  IN DATABASE ${database}
  TO ROLE ${role};`;
  const readGrants = `${warehouseGrant}\n\n${databaseGrants}`;

  const efGrants =
    isEventForwarder && authMethod !== "workload-identity"
      ? `GRANT CREATE SCHEMA ON DATABASE ${database} TO ROLE ${role};
CREATE SCHEMA ${database}.${efSchema};
GRANT USAGE ON SCHEMA ${database}.${efSchema} TO ROLE ${role};
GRANT CREATE TABLE ON SCHEMA ${database}.${efSchema} TO ROLE ${role};
GRANT INSERT ON ALL TABLES IN SCHEMA ${database}.${efSchema} TO ROLE ${role};
GRANT INSERT ON FUTURE TABLES IN SCHEMA ${database}.${efSchema} TO ROLE ${role};`
      : null;

  // TYPE = SERVICE marks a programmatic user: no MFA prompts, and
  // Snowflake's password retirement does not apply to it.
  const createUser = (auth: string) => `CREATE ROLE ${role};
CREATE USER ${user}
${auth}
GRANT ROLE ${role} TO USER ${user};
${readGrants}${efGrants ? `\n\n${efGrants}` : ""}`;

  // Grants are on the role, so a new role needs all of them again; otherwise
  // only the objects that moved.
  const changes: GrantChange[] = [];
  if (changed(p, saved, "role", SNOWFLAKE_FALLBACKS.role)) {
    changes.push({
      label: "role",
      sql: `CREATE ROLE ${role};
GRANT ROLE ${role} TO USER ${user};
ALTER USER ${user} SET DEFAULT_ROLE = ${role};
${readGrants}${efGrants ? `\n${efGrants}` : ""}`,
    });
  } else {
    if (changed(p, saved, "warehouse", SNOWFLAKE_FALLBACKS.warehouse)) {
      changes.push({ label: "warehouse", sql: warehouseGrant });
    }
    const databaseChanged = changed(
      p,
      saved,
      "database",
      SNOWFLAKE_FALLBACKS.database,
    );
    if (databaseChanged) {
      changes.push({
        label: "database",
        sql: `${databaseGrants}${efGrants ? `\n${efGrants}` : ""}`,
      });
    } else if (
      efGrants &&
      changed(p, saved, "schema", SNOWFLAKE_FALLBACKS.schema)
    ) {
      changes.push({ label: "schema", sql: efGrants });
    }
  }

  let userStep: SetupInstructionStep;
  if (authMethod === "workload-identity") {
    // The binding is all placeholders, so it behaves like a blank password:
    // shown on its own when nothing changed, left out when grants are needed.
    const binding: CredentialLiteral = {
      present: false,
      display: wifBinding,
      copy: wifBinding,
    };
    userStep = hasSavedUser(p, saved)
      ? updateUserStep({
          credential: binding,
          alter: (b) => `ALTER USER ${user} SET WORKLOAD_IDENTITY = ${b};`,
          changes,
          rotateOnly: "Only needed to change the identity binding.",
        })
      : {
          title: "Create a user and grant access",
          description: isEventForwarder
            ? "Self-hosted only. The Event Forwarder requires key-pair authentication."
            : "Self-hosted only. Run as ACCOUNTADMIN.",
          code: createUser(`  WORKLOAD_IDENTITY = ${wifBinding}
  TYPE = SERVICE;`),
        };
  } else if (authMethod === "password") {
    userStep = hasSavedUser(p, saved)
      ? updateUserStep({
          credential: password,
          alter: (pw) => `ALTER USER ${user} SET PASSWORD = ${pw};`,
          changes,
          rotateOnly:
            "Only needed to rotate the password. Grants are unchanged.",
        })
      : {
          title: "Create a user and grant access",
          description: isEventForwarder
            ? "Run as ACCOUNTADMIN. The Event Forwarder requires key-pair authentication."
            : "Run as ACCOUNTADMIN.",
          ...withCredential(password, (pw) =>
            createUser(`  DEFAULT_ROLE = ${role}
  PASSWORD = ${pw};`),
          ),
          codeNote: password.note,
        };
  } else {
    userStep = hasSavedUser(p, saved)
      ? updateUserStep({
          credential: publicKey,
          alter: (key) => `ALTER USER ${user} SET RSA_PUBLIC_KEY = ${key};`,
          changes,
          rotateOnly: "Only needed to change the key. Grants are unchanged.",
        })
      : {
          title: "Create a user and grant access",
          description: "Run as ACCOUNTADMIN.",
          code: createUser(`  TYPE = SERVICE
  DEFAULT_ROLE = ${role}
  RSA_PUBLIC_KEY = ${publicKeyLiteral};`),
          codeNote: publicKey.note,
        };
  }

  return [
    userStep,
    networkAccessStep({
      description: "Only if a network policy restricts IPs.",
      ctx,
      code: (ips) => `CREATE NETWORK POLICY GROWTHBOOK_POLICY
  ALLOWED_IP_LIST = (${ips.map((ip) => `'${ip}'`).join(", ")});
ALTER USER ${user}
  SET NETWORK_POLICY = GROWTHBOOK_POLICY;`,
    }),
    TEST_STEP,
  ];
};

const databricksSteps: StepBuilder<"databricks"> = (p, ctx) => {
  const { isEventForwarder, eventForwarderDestination } = ctx;
  const catalog = field(p, "catalog", "main");
  // Match DatabricksForm: connections saved before authType existed are PAT.
  const authType = p.authType ?? "pat";
  const usingOauth = isEventForwarder || authType === "oauth-m2m";
  const principal = "`<service-principal-application-id>`";
  // Falls back to the form's own default only while the destination is still
  // unknown; once chosen, the grant must match it or the write test fails.
  const efSchema =
    eventForwarderDestination?.location?.trim() || "growthbook_events";

  let grantCode = `GRANT USE CATALOG ON CATALOG ${catalog}
  TO ${principal};
GRANT USE SCHEMA, SELECT ON SCHEMA ${catalog}.<schema>
  TO ${principal};`;

  if (isEventForwarder) {
    grantCode += `

GRANT USE SCHEMA, CREATE TABLE
  ON SCHEMA ${catalog}.${efSchema}
  TO ${principal};`;
  }

  return [
    {
      title: "Find connection details",
      description:
        "Copy the server hostname, port, and HTTP path into the form.",
    },
    usingOauth
      ? {
          title: "Create a service principal",
          description: isEventForwarder
            ? "Copy the Client ID and OAuth secret into the form. Required for the Event Forwarder."
            : "Copy the Client ID and OAuth secret into the form.",
        }
      : {
          title: "Create a personal access token",
          description:
            "Create a token for a user or service principal and paste it into the form. OAuth is recommended.",
        },
    {
      title: "Grant access",
      description: isEventForwarder
        ? "Replace the application ID and the schema in the read grant. Unity Catalog only. The Event Forwarder grant already uses your chosen Event Destination schema."
        : "Replace the application ID and schema.",
      code: grantCode,
    },
    networkAccessStep({
      description: "Only if IP access lists are on.",
      ctx,
    }),
    TEST_STEP,
  ];
};

const redshiftSteps: StepBuilder<"redshift"> = (p, ctx) => {
  const { saved } = ctx;
  const user = field(p, "user", "growthbook_user");
  const schema = field(p, "defaultSchema", "public");
  const port = field(p, "port", "5439");
  const password = passwordFor(p, "backslash");
  const schemaGrants = `GRANT USAGE ON SCHEMA ${schema} TO ${user};
GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO ${user};
ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema}
  GRANT SELECT ON TABLES TO ${user};`;

  // Users are cluster-wide but schema grants live in a database, so a new
  // database needs them run again there.
  const changes: GrantChange[] = [];
  if (changed(p, saved, "database", "")) {
    changes.push({ label: "database", sql: schemaGrants });
  } else if (changed(p, saved, "defaultSchema", "public")) {
    changes.push({ label: "schema", sql: schemaGrants });
  }

  return [
    {
      title: "Find connection details",
      description:
        "Copy the workgroup endpoint into the form. It splits into host, port, and database. Require SSL is recommended.",
    },
    {
      title: "Configure security settings",
      description: `Turn on publicly accessible. Allow inbound TCP ${port} from this IP.`,
      code: `Protocol: TCP
Port: ${port}
Source: ${CLOUD_EGRESS_IP}/32`,
    },
    hasSavedUser(p, saved)
      ? updateUserStep({
          credential: password,
          alter: (pw) => `ALTER USER ${user} PASSWORD ${pw};`,
          changes,
          rotateOnly:
            "Only needed to rotate the password. Grants are unchanged.",
        })
      : {
          title: "Create a read-only user",
          description: "Run in the query editor.",
          ...withCredential(
            password,
            (pw) => `CREATE USER ${user} WITH PASSWORD ${pw};
${schemaGrants}`,
          ),
          codeNote: password.note,
        },
    TEST_STEP,
  ];
};

const athenaSteps: StepBuilder<"athena"> = () => [
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
  },
  {
    title: "Create an access key",
    description:
      "IAM → Security credentials → Create access key → Third-party service. Self-hosted GrowthBook can use auto-discovery or an IAM role instead.",
  },
  TEST_STEP,
];

const prestoSteps: StepBuilder<"presto"> = () => [
  {
    title: "Choose engine and auth",
    description:
      "Presto or Trino. Basic, Custom, or None. None sets the user to growthbook and is not recommended on GrowthBook Cloud.",
  },
  {
    title: "Enter connection details",
    description:
      "Host includes http:// or https://. Port defaults to 8080. Set catalog and schema. Source defaults to GrowthBook.",
  },
  TEST_STEP,
];

const clickhouseSteps: StepBuilder<"clickhouse"> = (p, ctx) => [
  {
    title: "Create read-only credentials",
    description:
      "In ClickHouse Cloud, copy the connection string. Use read-only credentials.",
  },
  networkAccessStep({
    description: "If ClickHouse is behind a firewall, allow this IP.",
    ctx,
  }),
  TEST_STEP,
];

const postgresSteps: StepBuilder<"postgres"> = (p, ctx) => {
  const { saved } = ctx;
  const user = pgIdentifier(field(p, "user", "growthbook"));
  const database = pgIdentifier(field(p, "database", "your_database"));
  const schema = pgIdentifier(field(p, "defaultSchema", "public"));
  const password = passwordFor(p, "quote-only");
  const connectGrant = `GRANT CONNECT ON DATABASE ${database} TO ${user};`;
  const schemaGrants = `GRANT USAGE ON SCHEMA ${schema} TO ${user};
GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO ${user};
ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema}
  GRANT SELECT ON TABLES TO ${user};`;

  // Schema grants live in a database, so a new database needs both.
  const changes: GrantChange[] = [];
  if (changed(p, saved, "database", "your_database")) {
    changes.push({
      label: "database",
      sql: `${connectGrant}\n${schemaGrants}`,
    });
  } else if (changed(p, saved, "defaultSchema", "public")) {
    changes.push({ label: "schema", sql: schemaGrants });
  }

  return [
    hasSavedUser(p, saved)
      ? updateUserStep({
          credential: password,
          alter: (pw) => `ALTER USER ${user} WITH PASSWORD ${pw};`,
          changes,
          rotateOnly:
            "Only needed to rotate the password. Grants are unchanged.",
        })
      : {
          title: "Create a read-only user",
          description:
            "Use a dedicated role so GrowthBook cannot modify data. Grant SELECT only on the schemas that hold experiment assignment and metric events.",
          ...withCredential(
            password,
            (pw) => `CREATE USER ${user} WITH PASSWORD ${pw};
${connectGrant}
${schemaGrants}`,
          ),
          codeNote: `${password.note} Grants use the Default Schema field; change it there if events live in another schema.`,
        },
    networkAccessOrDockerStep(
      ctx,
      "If a firewall, security group, or pg_hba.conf is in front of Postgres, allow this IP.",
    ),
    TEST_STEP,
  ];
};

const mysqlSteps: StepBuilder<"mysql"> = (p, ctx) => {
  const { saved } = ctx;
  const user = field(p, "user", "growthbook");
  const database = field(p, "database", "your_database");
  const port = field(p, "port", "3306");
  const password = passwordFor(p, "backslash");
  const selectGrant = `GRANT SELECT ON ${database}.* TO '${user}'@'%';
FLUSH PRIVILEGES;`;
  const changes: GrantChange[] = changed(p, saved, "database", "your_database")
    ? [{ label: "database", sql: selectGrant }]
    : [];
  return [
    hasSavedUser(p, saved)
      ? updateUserStep({
          credential: password,
          alter: (pw) => `ALTER USER '${user}'@'%' IDENTIFIED BY ${pw};`,
          changes,
          rotateOnly:
            "Only needed to rotate the password. Grants are unchanged.",
        })
      : {
          title: "Create a read-only user",
          description:
            "Grant SELECT on the database. Restrict the host from '%' when you can.",
          ...withCredential(
            password,
            (pw) => `CREATE USER '${user}'@'%' IDENTIFIED BY ${pw};
${selectGrant}`,
          ),
          codeNote: password.note,
        },
    networkAccessOrDockerStep(ctx, `Allow port ${port} from this IP.`),
    TEST_STEP,
  ];
};

const mssqlSteps: StepBuilder<"mssql"> = (p, ctx) => {
  const { saved } = ctx;
  const user = field(p, "user", "growthbook");
  const schema = field(p, "defaultSchema", "dbo");
  const port = field(p, "port", "1433");
  const password = passwordFor(p, "quote-only");
  const databaseUser = `CREATE USER ${user} FOR LOGIN ${user};`;
  const schemaGrant = `GRANT SELECT ON SCHEMA::${schema} TO ${user};`;

  // Logins are server-wide but users are per database, so a new database
  // needs its own user before the grant.
  const changes: GrantChange[] = [];
  if (changed(p, saved, "database", "")) {
    changes.push({ label: "database", sql: `${databaseUser}\n${schemaGrant}` });
  } else if (changed(p, saved, "defaultSchema", "dbo")) {
    changes.push({ label: "schema", sql: schemaGrant });
  }

  return [
    hasSavedUser(p, saved)
      ? updateUserStep({
          credential: password,
          alter: (pw) => `ALTER LOGIN ${user} WITH PASSWORD = ${pw};`,
          changes,
          rotateOnly:
            "Only needed to rotate the password. Grants are unchanged.",
        })
      : {
          title: "Create a read-only login",
          description: "Grant SELECT on the schema.",
          ...withCredential(
            password,
            (pw) => `CREATE LOGIN ${user} WITH PASSWORD = ${pw};
${databaseUser}
${schemaGrant}`,
          ),
          codeNote: password.note,
        },
    networkAccessOrDockerStep(
      ctx,
      `Allow port ${port} from this IP. Encryption defaults to on.`,
      "GrowthBook runs in Docker. Set the server to host.docker.internal instead of localhost. Encryption defaults to on.",
    ),
    TEST_STEP,
  ];
};

const verticaSteps: StepBuilder<"vertica"> = (p, ctx) => [
  {
    title: "Create a dedicated user",
    description:
      "Optional. Grant SELECT, and allow HOST password auth from GrowthBook Cloud.",
  },
  networkAccessStep({
    description: "If Vertica is firewalled, allow this IP.",
    ctx,
  }),
  TEST_STEP,
];

const adobeSteps: StepBuilder<
  "adobe_experience_platform_query_service"
> = () => [
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
  TEST_STEP,
];

const mixpanelSteps: StepBuilder<"mixpanel"> = () => [
  {
    title: "Use a warehouse export",
    description:
      "Direct Mixpanel is no longer supported. Export to a warehouse, then connect that. See the {link}.",
    docLink: { section: "mixpanel", label: "Mixpanel guide" },
  },
];

const googleAnalyticsSteps: StepBuilder<"google_analytics"> = () => [
  {
    title: "Connect GA4 through BigQuery",
    description: "GrowthBook reads GA4 from BigQuery. Steps are in the {link}.",
    docLink: { section: "google_analytics", label: "GA4 guide" },
  },
];

const growthbookClickhouseSteps: StepBuilder<"growthbook_clickhouse"> = () => [
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

const STEP_BUILDERS: { [T in DataSourceType]: StepBuilder<T> } = {
  bigquery: bigquerySteps,
  snowflake: snowflakeSteps,
  databricks: databricksSteps,
  redshift: redshiftSteps,
  athena: athenaSteps,
  presto: prestoSteps,
  clickhouse: clickhouseSteps,
  postgres: postgresSteps,
  mysql: mysqlSteps,
  mssql: mssqlSteps,
  vertica: verticaSteps,
  adobe_experience_platform_query_service: adobeSteps,
  mixpanel: mixpanelSteps,
  google_analytics: googleAnalyticsSteps,
  growthbook_clickhouse: growthbookClickhouseSteps,
};

export type SetupInstructionOptions = {
  existing?: boolean;
  /**
   * The saved connection's params when editing. Lets the SQL alter the
   * existing user and repeat only the grants whose inputs changed.
   */
  saved?: Partial<DataSourceParams> | null;
  cloud?: boolean;
  /** Defaults to every region, which is the right answer when none is chosen yet. */
  eventForwarderRegions?: DataRegion[];
  /** The dataset/schema/catalog-schema chosen in the Event Destination fields. */
  eventForwarderDestination?: EventForwarderDestination | null;
  snowflakeKeyPair?: SnowflakeKeyPair | null;
};

export function getDataSourceSetupInstructions(
  type: DataSourceType,
  setup: ConnectSetupKind,
  params?: Partial<DataSourceParams>,
  {
    existing = false,
    saved = null,
    cloud = false,
    eventForwarderRegions = ["us-east-1", "eu-west-1"],
    eventForwarderDestination = null,
    snowflakeKeyPair = null,
  }: SetupInstructionOptions = {},
): SetupInstructionStep[] {
  // `type` says which member of the `params` union this is, but TypeScript
  // cannot correlate the two, so widen the builder once here instead of
  // casting inside every builder.
  const build = STEP_BUILDERS[type] as StepBuilder<DataSourceType>;
  return build(params ?? {}, {
    isEventForwarder: setup === "event_forwarder",
    eventForwarderRegions,
    eventForwarderDestination,
    existing,
    saved: existing ? saved : null,
    cloud,
    snowflakeKeyPair,
  });
}
