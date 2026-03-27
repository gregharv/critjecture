import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const sourcePath = require.resolve("@mariozechner/pi-web-ui/app.css");
const outputPath = path.resolve(
  import.meta.dirname,
  "../app/pi-web-ui.generated.css",
);

const sourceCss = await readFile(sourcePath, "utf8");
const sanitizedCss = sourceCss.replace(/@font-face\{[^}]*\}/g, "");

const banner = [
  "/*",
  " * Generated from @mariozechner/pi-web-ui/app.css.",
  " * Do not hand-edit this file.",
  " * Refresh with: pnpm --filter web sync:pi-web-ui-css",
  " */",
  "",
].join("\n");

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${banner}${sanitizedCss}\n`, "utf8");

console.log(`Wrote ${path.relative(process.cwd(), outputPath)}`);
