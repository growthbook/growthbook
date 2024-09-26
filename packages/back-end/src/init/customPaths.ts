import path from "node:path";
import * as moduleAlias from "module-alias";
moduleAlias.addAlias("back-end/src", path.join(__dirname, ".."));
