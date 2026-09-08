import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateAll } from "../generate/emit.js";

const generatedDir = join(dirname(fileURLToPath(import.meta.url)), "../../generated");
mkdirSync(generatedDir, { recursive: true });
for (const [name, content] of Object.entries(generateAll())) {
  writeFileSync(join(generatedDir, name), content.endsWith("\n") ? content : `${content}\n`, "utf8");
}
