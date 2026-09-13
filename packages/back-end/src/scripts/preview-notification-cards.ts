import { mkdtemp, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import { sampleCard } from "back-end/src/services/notificationCards/cardImages";
import {
  listCardStyles,
  renderExperimentCard,
} from "back-end/src/services/notificationCards/experimentCards";

async function main() {
  const directory = await mkdtemp(
    join(tmpdir(), "growthbook-notification-cards-"),
  );
  const card = sampleCard("warning");
  card.event = "warning";
  const styles = listCardStyles();
  for (const { id } of styles) {
    const png = await renderExperimentCard(card, id);
    await writeFile(join(directory, `${id}.png`), png, { flag: "wx" });
  }
  const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GrowthBook notification card previews</title>
<style>body{font:16px system-ui;margin:32px auto;padding:0 24px;max-width:1200px;background:#f5f5f5;color:#222}img{max-width:100%;height:auto}section{margin:32px 0}</style>
<h1>Notification Card Previews</h1>
<p>Sample SRM warning data rendered with the production card renderer. These previews do not send notifications or load customer data.</p>
${styles.map(({ id, label }) => `<section><h2>${label}</h2><a href="${id}.png" download>Download PNG</a><p><img src="${id}.png" alt="${label} sample SRM warning card"></p></section>`).join("\n")}
</html>`;
  const index = join(directory, "index.html");
  await writeFile(index, html, { flag: "wx" });
  process.stdout.write(`Open ${pathToFileURL(index).href}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
