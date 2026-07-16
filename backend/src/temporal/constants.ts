/**
 * Workflow-safe constants. This module must stay free of Node-only imports
 * (no process.env, no db, no config) so it can be pulled into the Temporal
 * workflow sandbox bundle. The worker reads env-overridable values from
 * config; keep these literals in sync if you override the queue names.
 */
export const DEFAULT_TASK_QUEUE = "deal-hunter";
export const BROWSER_TASK_QUEUE = "browser-box";
