package com.parthadae.seneschal.voice.tools

/**
 * A client-executed tool in the hybrid tool architecture. Feature modules
 * group tools into a [VoiceToolPack] and bind it into the Hilt multibinding
 * set (see di/VoiceModule.kt); [VoiceToolRegistry] advertises the catalog to
 * the backend's LLM loop and executes the calls it returns.
 *
 * The shape mirrors MCP's tool descriptor (name, description, JSON-schema
 * parameters) so these could be exposed over real MCP later.
 */
interface VoiceTool {
    /** Stable snake_case identifier, unique across all packs. */
    val name: String

    /** What the tool does and when to use it, written for the LLM. */
    val description: String

    /** JSON schema for the arguments object. */
    val parameters: Map<String, Any?>

    /**
     * Destructive tools the voice layer should confirm before running.
     * Currently advisory (carried in the catalog for a future confirmation
     * turn).
     */
    val requiresConfirmation: Boolean get() = false

    /** Short overlay label while executing, e.g. "Logging time…". */
    val progressLabel: String

    suspend fun execute(args: Map<String, Any?>): VoiceToolResult
}

/**
 * [text] is fed back to the LLM as the tool output (it composes the final
 * spoken reply from it), so it should be a complete, speech-friendly
 * sentence or compact JSON. [success] only drives the overlay's done/error
 * icon.
 */
data class VoiceToolResult(
    val text: String,
    val success: Boolean = true,
)

/** A feature's contribution of tools; bound via Hilt multibinding. */
interface VoiceToolPack {
    val tools: List<VoiceTool>
}
