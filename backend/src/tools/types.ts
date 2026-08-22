import type { ChatToolDef } from "../llm/index.js";

/**
 * The tool contract shared by both halves of the hybrid architecture:
 *
 * - Client tools are implemented on the phone (wrapping its offline-first
 *   repositories) and advertised to the server in each /voice/command
 *   request. The server never executes them; it returns their calls to the
 *   phone.
 * - Server tools live in this process (see registry.ts) and are executed
 *   inline during the LLM loop.
 *
 * The shape deliberately mirrors MCP's tool descriptor (name, description,
 * JSON-schema parameters) so exposing the server registry over real MCP
 * later is a thin adapter, without taking the protocol dependency now.
 */
export type ToolDef = {
  name: string;
  description: string;
  /** JSON schema for the arguments object. */
  parameters: Record<string, unknown>;
  execution: "client" | "server";
  /**
   * Destructive tools the voice layer should confirm before running.
   * Currently advisory (carried in catalogs for a future confirmation turn).
   */
  requiresConfirmation?: boolean;
};

export type ServerTool = ToolDef & {
  execution: "server";
  /** Returns a JSON-serializable result fed back to the LLM as tool output. */
  handler: (userId: string, args: Record<string, unknown>) => Promise<unknown>;
};

export function toChatTool(tool: ToolDef): ChatToolDef {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}
