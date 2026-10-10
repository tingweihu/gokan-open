import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const cli = require.resolve("prisma/build/index.js");
const schema = fileURLToPath(new URL("../prisma/schema.prisma", import.meta.url));

const env = { ...process.env };
if (!env.DATABASE_URL && ["generate", "validate"].includes(process.argv[2] ?? "")) {
  env.DATABASE_URL = "postgresql://prisma:prisma@localhost:5432/prisma";
}

const result = spawnSync(
  process.execPath,
  [cli, ...process.argv.slice(2), "--schema", schema],
  { env, stdio: "inherit" },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
