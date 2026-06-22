const kerberos = require("kerberos");
const presto = require("presto-client");

const servicePrincipal = "trino@trino.docker.internal";
const clientPrincipal = "growthbook@TEST.LOCAL";

async function executeQuery(token, query, catalog = "memory", schema = "default") {
  const configOptions = {
    engine: "trino",
    host: "trino.docker.internal",
    port: 8443,
    user: "growthbook",
    source: "growthbook",
    schema: schema,
    catalog: catalog,
    timeout: 300000, // 5 minute timeout for large queries
    checkInterval: 500,
    ssl: {
      rejectUnauthorized: false,
    },
  };

  if (token) {
    configOptions.custom_auth = `Negotiate ${token}`;
  }

  const client = new presto.Client(configOptions);

  return new Promise((resolve, reject) => {
    let cols = [];
    const rows = [];

    const executeOptions = {
      query: query,
      catalog: catalog,
      schema: schema,
      columns: (error, data) => {
        if (error) {
          console.error("Column error:", error);
          return;
        }
        cols = data.map((d) => d.name);
      },
      error: (error) => {
        console.error("Query error:", error);
        reject(error);
      },
      data: (error, data) => {
        if (error) {
          console.error("Data error:", error);
          return;
        }
        data.forEach((d) => {
          const row = {};
          d.forEach((v, i) => {
            row[cols[i]] = v;
          });
          rows.push(row);
        });
      },
      success: () => {
        resolve({ rows, columns: cols });
      },
    };

    if (token) {
      executeOptions.user = "growthbook";
    }

    client.execute(executeOptions);
  });
}

(async () => {
  try {
    console.log("Initializing Kerberos client...");
    const client = await kerberos.initializeClient(servicePrincipal, {
      mechOID: kerberos.GSS_MECH_OID_KRB5,
      principal: clientPrincipal,
    });

    console.log("Generating Kerberos token...");
    const token = await client.step("");
    console.log("Token generated successfully\n");

    // Create schema
    console.log("Creating schema...");
    await executeQuery(token, "CREATE SCHEMA IF NOT EXISTS memory.default");

    // Drop table if exists
    console.log("Dropping existing table if exists...");
    try {
      await executeQuery(token, "DROP TABLE IF EXISTS memory.default.large_sample_data");
    } catch (e) {
      console.log("Table doesn't exist yet, continuing...");
    }

    // Create a large table with generated data
    // This will create approximately 200MB of data
    console.log("\nGenerating large dataset (this may take a minute)...");
    const createTableQuery = `
      CREATE TABLE memory.default.large_sample_data AS
      SELECT
        row_number() OVER () as id,
        md5(cast(random() as varchar)) as hash_col1,
        md5(cast(random() as varchar)) as hash_col2,
        md5(cast(random() as varchar)) as hash_col3,
        md5(cast(random() as varchar)) as hash_col4,
        md5(cast(random() as varchar)) as hash_col5,
        random() * 1000000 as random_num1,
        random() * 1000000 as random_num2,
        random() * 1000000 as random_num3,
        from_unixtime(cast(random() * 1640000000 as bigint)) as random_date,
        CASE
          WHEN random() < 0.33 THEN 'Category A'
          WHEN random() < 0.66 THEN 'Category B'
          ELSE 'Category C'
        END as category,
        repeat('Sample data string for padding ', cast(random() * 20 as integer)) as large_text
      FROM (
        SELECT sequence(1, 500000) as x
      )
      CROSS JOIN UNNEST(x) as t(n)
    `;

    await executeQuery(token, createTableQuery);
    console.log("✓ Large dataset created successfully!");

    // Get table stats
    console.log("\nGetting table statistics...");
    const stats = await executeQuery(
      token,
      "SELECT COUNT(*) as row_count FROM memory.default.large_sample_data"
    );
    console.log(`✓ Table contains ${stats.rows[0].row_count} rows`);

    // Show sample data
    console.log("\nSample data (first 5 rows):");
    const sample = await executeQuery(
      token,
      "SELECT id, hash_col1, random_num1, category FROM memory.default.large_sample_data LIMIT 5"
    );
    console.table(sample.rows);

    console.log("\n=== Data loaded successfully! ===");
    console.log("\nYou can now run expensive queries like:");
    console.log("  SELECT category, AVG(random_num1), COUNT(*) FROM memory.default.large_sample_data GROUP BY category");
    console.log("  SELECT * FROM memory.default.large_sample_data WHERE random_num1 > 500000 ORDER BY random_num2");
    console.log("  SELECT hash_col1, COUNT(*) FROM memory.default.large_sample_data GROUP BY hash_col1");

  } catch (error) {
    console.error("\n❌ Error:", error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
})();
