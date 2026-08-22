import { marketplaceTools } from "./marketplacePack.js";
import type { ServerTool } from "./types.js";

/**
 * All server-hosted tools, merged into the LLM's catalog alongside whatever
 * client tools the phone advertises. New backend features contribute a pack
 * here (thrawn, lazax, ...).
 */
export const serverToolRegistry: ServerTool[] = [...marketplaceTools];
