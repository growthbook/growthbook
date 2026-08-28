import { getMongod } from "./mongo";

export default async function globalTeardown() {
  await getMongod()?.stop();
}
