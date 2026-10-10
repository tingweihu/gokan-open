import "reflect-metadata";
import { Database } from "./core.js";
import { IdentityService } from "./identity.service.js";
const db = new Database();
async function main() {
  try {
    const result = await new IdentityService(db).bootstrap({
      email: process.env.BOOTSTRAP_ADMIN_EMAIL,
      displayName: process.env.BOOTSTRAP_ADMIN_NAME,
      temporaryPassword: process.env.BOOTSTRAP_ADMIN_PASSWORD,
      year: Number(process.env.BOOTSTRAP_YEAR),
    });
    console.log(JSON.stringify(result));
  } finally {
    await db.$disconnect();
  }
}
void main().catch(() => {
  console.error(
    "Bootstrap failed. Check supplied values and ensure no existing baseline. No recovery override is supported.",
  );
  process.exitCode = 1;
});
