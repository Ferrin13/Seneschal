import { NativeConnection, Worker } from "@temporalio/worker";
import { config } from "../config.js";
import { TASK_QUEUE } from "./shared.js";
import * as activities from "./activities/index.js";
import { pool } from "../db/client.js";
import { syncAllHuntSchedules } from "./schedules.js";

/**
 * Backend Temporal worker. Services the default (server-side) task queue:
 * Craigslist fetch, all LLM calls, comps, evaluation, and DB writes. The
 * Facebook load-and-parse activities live in a separate worker on the browser
 * box (see agent/).
 */
async function run() {
  const connection = await NativeConnection.connect({
    address: config.TEMPORAL_ADDRESS,
  });

  const worker = await Worker.create({
    connection,
    namespace: config.TEMPORAL_NAMESPACE,
    taskQueue: TASK_QUEUE,
    workflowsPath: require.resolve("./workflows"),
    activities,
  });

  console.log(
    `Temporal worker listening on "${TASK_QUEUE}" (namespace ${config.TEMPORAL_NAMESPACE})`
  );

  // Register/refresh a recurring hunt schedule per active target.
  try {
    const n = await syncAllHuntSchedules();
    console.log(`Synced ${n} hunt schedule(s).`);
  } catch (err) {
    console.warn(`Schedule sync failed: ${(err as Error).message}`);
  }

  try {
    await worker.run();
  } finally {
    await connection.close();
    await pool.end();
  }
}

run().catch((err) => {
  console.error("Worker crashed:", err);
  process.exit(1);
});
