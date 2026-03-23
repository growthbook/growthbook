/**
 * Script to create feature drafts for testing pagination
 * 
 * Usage:
 * 1. Log into GrowthBook in your browser (http://localhost:3000)
 * 2. Open DevTools > Application > Cookies > http://localhost:3000
 * 3. Copy the value of the 'gb_session' cookie
 * 4. Run: GB_SESSION="your-cookie-value" node create-test-drafts.mjs
 */

// Node 18+ has native fetch
const API_HOST = 'http://localhost:3100';
const GB_SESSION = process.env.GB_SESSION;

if (!GB_SESSION) {
  console.error('❌ Please set GB_SESSION environment variable');
  console.error('\nSteps:');
  console.error('1. Log into GrowthBook at http://localhost:3000');
  console.error('2. Open DevTools > Application > Cookies');
  console.error('3. Copy the gb_session cookie value');
  console.error('4. Run: GB_SESSION="cookie-value" node create-test-drafts.mjs\n');
  process.exit(1);
}

async function createFeatureWithDraft(index) {
  const featureId = `test-pagination-${index}-${Date.now()}`;
  
  try {
    // Step 1: Create feature
    const createRes = await fetch(`${API_HOST}/feature`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `gb_session=${GB_SESSION}`
      },
      body: JSON.stringify({
        id: featureId,
        valueType: 'boolean',
        defaultValue: 'false',
        description: `Test feature ${index} for pagination`
      })
    });

    if (!createRes.ok) {
      const error = await createRes.text();
      console.error(`✗ Failed to create feature ${index}: ${createRes.status} ${error}`);
      return null;
    }

    const feature = await createRes.json();
    console.log(`✓ Created feature: ${featureId}`);

    // Step 2: Create a draft by forking the current version
    const forkRes = await fetch(`${API_HOST}/feature/${featureId}/${feature.version}/fork`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `gb_session=${GB_SESSION}`
      },
      body: JSON.stringify({})
    });

    if (!forkRes.ok) {
      const error = await forkRes.text();
      console.error(`✗ Failed to create draft for ${featureId}: ${forkRes.status} ${error}`);
      return featureId;
    }

    const draft = await forkRes.json();
    console.log(`✓ Created draft version ${draft.version} for: ${featureId}`);
    return featureId;

  } catch (err) {
    console.error(`✗ Error creating feature ${index}:`, err.message);
    return null;
  }
}

async function main() {
  const numToCreate = 25;
  console.log(`Creating ${numToCreate} features with drafts for pagination testing...\n`);
  
  const created = [];
  for (let i = 1; i <= numToCreate; i++) {
    const result = await createFeatureWithDraft(i);
    if (result) created.push(result);
    
    // Small delay to avoid overwhelming the server
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  console.log(`\n✅ Done! Created ${created.length} features with drafts.`);
  console.log('\nNext steps:');
  console.log('1. Go to http://localhost:3000/features');
  console.log('2. Click the "Drafts & Review" tab');
  console.log('3. Verify pagination appears and works correctly');
  console.log('\nTo clean up, you can archive/delete these test features later.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
