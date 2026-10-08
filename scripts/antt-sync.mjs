import { syncAntt } from "../src/services/anttMonitor.js";
import { pool } from "../src/db/pool.js";
try {
  const result = await syncAntt({ force: process.argv.includes("--force") });
  console.log(JSON.stringify(result));
  if (["error", "review"].includes(result.status)) process.exitCode = 1;
} finally {
  await pool.end();
}
