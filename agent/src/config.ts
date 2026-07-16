/**
 * Browser-box worker configuration from the environment. On the browser box
 * these come from the systemd unit / cloud-init; locally, export them in your
 * shell (or rely on the defaults).
 */
export const config = {
  // CDP endpoint of the local headed, logged-in Chrome.
  cdpUrl: process.env.CHROME_CDP_URL ?? "http://127.0.0.1:9222",
  // Friendly name identifying this box.
  agentName: process.env.AGENT_NAME ?? "browser-box",
  // Cap on images captured per listing.
  maxImages: Number(process.env.AGENT_MAX_IMAGES ?? 20),

  // Temporal: this worker services the browser task queue with the Facebook
  // load-and-parse activities. Point it at the same cluster as the backend.
  temporalAddress: process.env.TEMPORAL_ADDRESS ?? "127.0.0.1:7233",
  temporalNamespace: process.env.TEMPORAL_NAMESPACE ?? "default",
  browserTaskQueue: process.env.TEMPORAL_BROWSER_TASK_QUEUE ?? "browser-box",
};
