// Dev-only: render a real experiment's Slack results card to a PNG file, so you
// can eyeball the snapshot→card mapping with actual data — no S3, no Slack, no
// auth. Usage:
//
//   pnpm --filter back-end exec tsx src/scripts/dev-render-card.ts \
//     --experiment exp_abc123 [--org org_abc] [--out ./card.png]
//
// eslint-disable-next-line no-restricted-imports
import "../init/aliases";
import fs from "fs";
import { init } from "back-end/src/init";
import { findAllOrganizations } from "back-end/src/models/OrganizationModel";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { buildExperimentCardData } from "back-end/src/services/slack/experimentCardData";
import { renderExperimentCard } from "back-end/src/services/slack/cards";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a && a.startsWith("--")) {
      const val = argv[i + 1];
      if (val && !val.startsWith("--")) {
        out[a.slice(2)] = val;
        i++;
      } else {
        out[a.slice(2)] = "true";
      }
    }
  }
  return out;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const experimentId = args.experiment;
  const out = args.out || "./card.png";
  if (!experimentId) {
    console.error("Missing --experiment exp_...");
    process.exit(1);
  }

  await init();

  let organizationId = args.org;
  if (!organizationId) {
    const { organizations, total } = await findAllOrganizations(1, "", 50);
    if (total === 1 && organizations[0]) {
      organizationId = organizations[0].id;
    } else {
      console.error(
        `Found ${total} organizations — pass --org <id>. Options:\n` +
          organizations.map((o) => `  ${o.id}  (${o.name})`).join("\n"),
      );
      process.exit(1);
    }
  }

  const context = await getContextForAgendaJobByOrgId(organizationId);
  const card = await buildExperimentCardData(context, experimentId);
  if (!card) {
    console.error(
      `No card — experiment ${experimentId} not found in org ${organizationId}.`,
    );
    process.exit(1);
  }

  console.log(
    `Rendering "${card.name}" (${card.state}, ${card.rows.length} variation row(s))…`,
  );
  const png = await renderExperimentCard(card);
  fs.writeFileSync(out, png);
  console.log(`Wrote ${png.length} bytes to ${out}`);
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
