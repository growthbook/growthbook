import { v4 as uuidv4 } from "uuid";
import { assertSafeReadOnlySQL } from "shared/sql";
import { DataVizConfig } from "shared/validators";
import { BadRequestError } from "back-end/src/util/errors";

// Charts are addressed by id from dashboard blocks, so every one needs one.
export function withVizIds(configs: DataVizConfig[]): DataVizConfig[] {
  return configs.map((c) => ({ ...c, id: c.id || `data-viz_${uuidv4()}` }));
}

// The whole statement, so a writing CTE can't hide behind a leading WITH
export function assertReadOnlySql(sql: string) {
  try {
    assertSafeReadOnlySQL(sql.trim().replace(/;$/, ""));
  } catch (e) {
    throw new BadRequestError(`${e.message}.`);
  }
}
