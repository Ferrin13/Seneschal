package com.parthadae.seneschal.voice

/** A final speech-recognition transcript plus its normalized form. */
data class VoiceUtterance(
    val raw: String,
    /**
     * Lowercased, punctuation stripped, "p.m."-style meridiems collapsed to
     * "pm", leading wake words ("seneschal", "please") removed, whitespace
     * collapsed. Handlers should match against this.
     */
    val normalized: String,
)

sealed interface VoiceCommandResult {
    /** The command executed. [speech] is spoken aloud and shown in the overlay. */
    data class Success(val speech: String) : VoiceCommandResult

    /**
     * The handler owned this phrasing but couldn't complete it (unknown
     * activity, unparseable time, nothing to act on...). [speech] should tell
     * the user what to say instead.
     *
     * [transient] marks failures unrelated to what the user said (network
     * down, server misconfigured). The dispatcher prefers non-transient
     * failures when several handlers failed, since those are actionable.
     */
    data class Failure(
        val speech: String,
        val transient: Boolean = false,
    ) : VoiceCommandResult
}

/**
 * One feature's slice of the voice grammar. The long-term goal is that
 * everything doable in the app is doable by voice; each feature area gets
 * there by contributing handlers rather than growing a central parser.
 *
 * To add voice support for a new feature:
 *  1. Implement this interface, injecting whatever repositories you need.
 *     Return null from [handle] when the utterance isn't yours so the next
 *     handler gets a look.
 *  2. Bind it with `@Binds @IntoSet` in [com.parthadae.seneschal.di.VoiceModule].
 *  3. Pick a [priority]. Lower values are consulted first; put handlers with
 *     narrow, specific grammars at low numbers and catch-all phrasings high.
 */
interface VoiceCommandHandler {
    val priority: Int

    /** Example phrases, surfaced by the "what can you do" help command. */
    val examples: List<String>

    /** Return null if this utterance isn't recognized by this handler. */
    suspend fun handle(utterance: VoiceUtterance): VoiceCommandResult?
}
