// Script to create multiple feature drafts for testing pagination
// Run with: node test-create-drafts.js

const API_HOST = process.env.API_HOST || "http://localhost:3100";
const API_KEY = process.env.GROWTHBOOK_API_KEY;

if (!API_KEY) {
  console.error("Please set GROWTHBOOK_API_KEY environment variable");
  process.exit(1);
}

async function createFeature(index) {
  const featureId = `test-pagination-feature-${index}-${Date.now()}`;

  // Create the feature first
  const createResponse = await fetch(`${API_HOST}/api/v1/features`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      id: featureId,
      valueType: "boolean",
      defaultValue: "false",
      description: `Test feature ${index} for pagination testing`,
    }),
  });

  if (!createResponse.ok) {
    const error = await createResponse.text();
    console.error(`Failed to create feature ${index}:`, error);
    return null;
  }

  const feature = await createResponse.json();
  console.log(`✓ Created feature: ${featureId}`);

  // Now create a draft revision for it
  const draftResponse = await fetch(
    `${API_HOST}/api/v1/features/${featureId}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        defaultValue: "true", // Change the default value to create a draft
        comment: `Draft for testing pagination - feature ${index}`,
      }),
    },
  );

  if (!draftResponse.ok) {
    const error = await draftResponse.text();
    console.error(`Failed to create draft for feature ${index}:`, error);
    return null;
  }

  console.log(`✓ Created draft for: ${featureId}`);
  return featureId;
}

async function main() {
  console.log("Creating 25 features with drafts for pagination testing...\n");

  const promises = [];
  for (let i = 1; i <= 25; i++) {
    promises.push(createFeature(i));
    // Add small delay to avoid overwhelming the API
    if (i % 5 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  await Promise.all(promises);

  console.log("\n✅ Done! Created 25 features with drafts.");
  console.log(
    'Navigate to the Features page and click the "Drafts & Review" tab to test pagination.',
  );
}

main().catch(console.error);
