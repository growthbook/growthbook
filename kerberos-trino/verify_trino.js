const kerberos = require("kerberos");
const https = require("https");
const presto = require("presto-client");

const servicePrincipal = "trino@trino.docker.internal";
const clientPrincipal = "growthbook@TEST.LOCAL";

(async () => {
  try {
    console.log("Initializing Kerberos client...");
    const client = await kerberos.initializeClient(servicePrincipal, {
      mechOID: kerberos.GSS_MECH_OID_KRB5,
      principal: clientPrincipal,
    });

    console.log("Client initialized. Generating token...");
    const token = await client.step("");

    console.log("Token generated:", token.substring(0, 20) + "...");
    const noTokenResponse = await makeRequest(null);
    if (noTokenResponse.statusCode !== 401) {
      console.error(
        "Unexpected status code for no token response:",
        noTokenResponse.statusCode,
      );
    } else {
      console.log(
        "Success status code for no token response:",
        noTokenResponse.statusCode,
      );
    }

    const invalidResponse = await makeRequest("invalid token");
    if (invalidResponse.statusCode !== 401) {
      console.error(
        "Unexpected status code for invalid token response:",
        invalidResponse.statusCode,
      );
    } else {
      console.log(
        "Success status code for invalid token response:",
        invalidResponse.statusCode,
      );
    }

    const validResponse = await makeRequest(token);
    if (validResponse.statusCode !== 200) {
      console.error(
        "Unexpected status code for valid token response:",
        validResponse.statusCode,
      );
    } else {
      console.log(
        "Success status code for valid token response:",
        validResponse.statusCode,
      );
    }

    const reuseTokenResponse = await makeRequest(token);
    if (reuseTokenResponse.statusCode !== 401) {
      console.error(
        "Unexpected status code for reuse token response:",
        reuseTokenResponse.statusCode,
      );
    } else {
      console.log(
        "Success status code for reuse token response:",
        reuseTokenResponse.statusCode,
      );
    }
  } catch (error) {
    console.error("General error:", error);
  }
})();

function makeRequest(token) {
  const headers = {
    "Content-Type": "application/json",
    "X-Trino-User": "growthbook",
  };
  if (token) {
    headers.Authorization = `Negotiate ${token}`;
  }

  const requestOptions = {
    hostname: "trino.docker.internal",
    port: 8443,
    path: "/v1/statement",
    method: "POST",
    headers: headers,
    rejectUnauthorized: false,
  };

  console.log(
    "Sending request to Trino (token: " +
      (token ? token.substring(0, 20) + "..." : "NONE") +
      ")",
  );
  console.log("Headers:", JSON.stringify(headers));
  return new Promise((resolve, reject) => {
    const req = https.request(requestOptions, (res) => {
      res.setEncoding("utf8");
      let body = "";
      res.on("data", (chunk) => {
        console.log(`BODY: ${chunk}`);
        body += chunk;
      });
      res.on("end", () => {
        console.log("No more data in response.");
        console.log("Response headers:", JSON.stringify(res.headers));
        resolve(res);
      });
    });

    req.on("error", (e) => {
      console.error(`Problem with request: ${e.message}`);
      reject();
    });

    // Write data to request body
    req.write(JSON.stringify({ query: "SELECT 1" }));
    req.end();
  });
}
