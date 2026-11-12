import path from "path";
import ts from "typescript";

// A `Register` augmentation applies to everything compiled with it, so the
// fixture is compiled as its own program rather than as part of this test.
// It marks expected errors with @ts-expect-error, so a fixture that compiles
// cleanly has every expectation met.
const root = path.join(__dirname, "..");
const typesDir = path.join(root, "node_modules/.cache/registered-types");
const { options } = ts.parseJsonConfigFileContent(
  ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile).config,
  ts.sys,
  root,
);

function compileFixture(name: string): string[] {
  const program = ts.createProgram([path.join(__dirname, "fixtures", name)], {
    ...options,
    noEmit: true,
    declaration: false,
    declarationMap: false,
    baseUrl: root,
    paths: {
      "@growthbook/growthbook-react": [
        path.join(typesDir, "sdk-react/src/index.d.ts"),
      ],
      "@growthbook/growthbook": [path.join(typesDir, "sdk-js/src/index.d.ts")],
    },
  });
  return ts.getPreEmitDiagnostics(program).map((d) => {
    const line = d.file
      ? d.file.getLineAndCharacterOfPosition(d.start || 0).line + 1
      : 0;
    return `${path.basename(d.file?.fileName || "")}:${line} ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`;
  });
}

describe("registered types", () => {
  // The fixture compiles against declaration files, as an app would. Building
  // them here, for both SDKs from source, keeps the test independent of
  // whether either `dist` is up to date.
  beforeAll(() => {
    ts.createProgram([path.join(root, "src/index.ts")], {
      ...options,
      declaration: true,
      declarationMap: false,
      emitDeclarationOnly: true,
      outDir: typesDir,
      baseUrl: root,
      paths: { "@growthbook/growthbook": ["../sdk-js/src/index.ts"] },
    }).emit();
  }, 120000);

  it("types hooks and components from the Register interface", () => {
    expect(compileFixture("registered.tsx")).toEqual([]);
  }, 60000);

  it("needs no fallback values with a registered fallback payload", () => {
    expect(compileFixture("registered-payload.tsx")).toEqual([]);
  }, 60000);
});
