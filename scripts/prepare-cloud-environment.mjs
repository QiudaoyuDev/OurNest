import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { ENVIRONMENTS } = createRequire(import.meta.url)(
  path.join(root, "miniprogram/config/cloud-env.js")
);
const environmentKey = process.argv
  .find((argument) => argument.startsWith("--environment="))
  ?.slice(14);
const allowProduction = process.argv.includes("--allow-production");
const requiredCollections = [
  "users",
  "ledgers",
  "categories",
  "records",
  "ledgerInvites",
  "ledgerOperations",
  "feedbacks",
  "errorLogs",
];

if (!environmentKey || !Object.hasOwn(ENVIRONMENTS, environmentKey)) {
  throw new Error("Usage: node scripts/prepare-cloud-environment.mjs --environment=test");
}
if (environmentKey === "production" && !allowProduction) {
  throw new Error("Production requires --allow-production after backup and approval.");
}
const environment = ENVIRONMENTS[environmentKey];
if (!environment.id) throw new Error(`CLOUD_ENVIRONMENT_ID_MISSING:${environmentKey}`);

const cloudRequire = createRequire(path.join(root, "cloudfunctions/ourNest/package.json"));
let cloud;
try {
  cloud = cloudRequire("wx-server-sdk");
} catch (_error) {
  throw new Error("Install cloudfunctions/ourNest dependencies before preparing an environment.");
}

cloud.init({ env: environment.id });
const db = cloud.database();
let failed = false;
for (const name of requiredCollections) {
  try {
    await db.createCollection(name);
    console.info(`created ${name}`);
  } catch (error) {
    const message = String(error?.errMsg || error?.message || "");
    if (/exist|already/i.test(message)) {
      console.info(`exists ${name}`);
      continue;
    }
    failed = true;
    console.error(`failed ${name}: ${message || "unknown error"}`);
  }
}
if (failed) process.exitCode = 1;
else console.info(`Cloud environment ${environmentKey} is prepared.`);
