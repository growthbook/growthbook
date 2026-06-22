const kerberos = require("kerberos");
const presto = require("presto-client");

const servicePrincipal = "trino@trino.docker.internal";
const clientPrincipal = "growthbook@TEST.LOCAL";

async function runQuery(query) {
  const client = await kerberos.initializeClient(servicePrincipal, {
    mechOID: kerberos.GSS_MECH_OID_KRB5,
    principal: clientPrincipal,
  });

  const token = await client.step("");

  const prestoClient = new presto.Client({
    engine: "trino",
    host: "trino.docker.internal",
    port: 8443,
    user: "growthbook",
    source: "growthbook",
    schema: "default",
    catalog: "memory",
    timeout: 300000,
    checkInterval: 500,
    ssl: {
      rejectUnauthorized: false,
    },
    custom_auth: `Negotiate ${token}`,
  });

  return new Promise((resolve, reject) => {
    let cols;
    const rows = [];
    const startTime = Date.now();

    const executeOptions = {
      query: query,
      catalog: "memory",
      schema: "default",
      user: "growthbook",
      columns: (error, data) => {
        if (error) return;
        cols = data.map((d) => d.name);
      },
      error: (error) => {
        reject(error);
      },
      data: (error, data) => {
        if (error) return;
        data.forEach((d) => {
          const row = {};
          d.forEach((v, i) => {
            row[cols[i]] = v;
          });
          rows.push(row);
        });
      },
      success: () => {
        const duration = Date.now() - startTime;
        resolve({ rows, duration });
      },
    };

    prestoClient.execute(executeOptions);
  });
}

const queries = [
  {
    name: "Aggregation by category",
    sql: "SELECT category, AVG(num1) as avg_num1, AVG(num2) as avg_num2, COUNT(*) as cnt FROM memory.default.large_sample_data GROUP BY category",
  },
  {
    name: "Sort and filter",
    sql: "SELECT id, hash1, num1, num2, category FROM memory.default.large_sample_data WHERE num1 > 500000 ORDER BY num2 DESC LIMIT 1000",
  },
  {
    name: "Hash grouping",
    sql: "SELECT LEFT(hash1, 4) as hash_prefix, COUNT(*) as cnt FROM memory.default.large_sample_data GROUP BY LEFT(hash1, 4) ORDER BY cnt DESC LIMIT 20",
  },
  {
    name: "Complex aggregation",
    sql: "SELECT category, FLOOR(num1 / 100000) as num_bucket, COUNT(*) as cnt, AVG(num2) as avg_num2 FROM memory.default.large_sample_data GROUP BY category, FLOOR(num1 / 100000) ORDER BY category, num_bucket",
  },
];

(async () => {
  console.log("Testing expensive queries on 500,000 rows (~200MB dataset)\n");

  const queryIndex = parseInt(process.argv[2]) || 0;

  if (queryIndex === 0) {
    console.log("Available queries:");
    queries.forEach((q, i) => {
      console.log(`  ${i + 1}. ${q.name}`);
    });
    console.log(`\nUsage: node test_expensive_query.js <query_number>`);
    console.log(`Example: node test_expensive_query.js 1\n`);
    console.log("Running query 1 as default...\n");
  }

  const selectedQuery = queries[queryIndex - 1] || queries[0];

  console.log(`Query: ${selectedQuery.name}`);
  console.log(`SQL: ${selectedQuery.sql}\n`);
  console.log("Executing...");

  try {
    const result = await runQuery(selectedQuery.sql);
    console.log(`\n✓ Query completed in ${result.duration}ms`);
    console.log(`✓ Returned ${result.rows.length} rows\n`);

    if (result.rows.length > 0 && result.rows.length <= 20) {
      console.log("Results:");
      console.table(result.rows);
    } else if (result.rows.length > 20) {
      console.log("First 10 results:");
      console.table(result.rows.slice(0, 10));
      console.log(`\n... and ${result.rows.length - 10} more rows`);
    }
  } catch (error) {
    console.error("\n❌ Query failed:", error.message);
    process.exit(1);
  }
})();
