import { Client, Connection } from "@temporalio/client";
import { config } from "../config.js";
import { NAMESPACE } from "./shared.js";

/**
 * Lazily-created singleton Temporal client. The backend uses this to start
 * hunt workflows (from the manual trigger endpoint) and to manage schedules.
 */
let clientPromise: Promise<Client> | null = null;

export async function getTemporalClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const connection = await Connection.connect({
        address: config.TEMPORAL_ADDRESS,
      });
      return new Client({ connection, namespace: NAMESPACE });
    })();
  }
  return clientPromise;
}
