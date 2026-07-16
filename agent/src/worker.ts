import { NativeConnection, Worker } from "@temporalio/worker";
import { config } from "./config.js";
import * as activities from "./activities.js";
import { getContext } from "./browser.js";

/**
 * Browser-box Temporal worker. Activity-only (no workflows): services the
 * browser task queue with the Facebook load-and-parse activities, driving the
 * local logged-in Chrome over CDP. The backend worker runs everything else.
 */
async function run() {
  // Fail fast if Chrome isn't reachable, with a clear message.
  try {
    await getContext();
    console.log(`Connected to Chrome at ${config.cdpUrl}`);
  } catch (err) {
    console.error(
      `Could not connect to Chrome at ${config.cdpUrl}. Start Chrome with ` +
        `--remote-debugging-port=9222 and log in to Facebook first.`
    );
    throw err;
  }

  const connection = await NativeConnection.connect({
    address: config.temporalAddress,
  });

  const worker = await Worker.create({
    connection,
    namespace: config.temporalNamespace,
    taskQueue: config.browserTaskQueue,
    activities,
  });

  console.log(
    `Browser-box worker "${config.agentName}" listening on "${config.browserTaskQueue}"`
  );

  try {
    await worker.run();
  } finally {
    await connection.close();
  }
}

run().catch((err) => {
  console.error("Browser-box worker crashed:", err);
  process.exit(1);
});
