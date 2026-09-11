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
  // Probe Chrome up front for a clear log line, but keep running either way:
  // the scrape activities fail on their own if CDP is down, and the status /
  // reconnect / rebuild-tunnel activities must stay available precisely when
  // the tunnel is broken so the operator can fix it from the web UI.
  try {
    await getContext();
    console.log(`Connected to Chrome at ${config.cdpUrl}`);
  } catch (err) {
    console.warn(
      `Chrome not reachable at ${config.cdpUrl} (${(err as Error).message}). ` +
        `Continuing; Facebook activities will fail until the tunnel/Chrome is up.`
    );
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
