package com.parthadae.seneschal.voice.commands

import com.parthadae.seneschal.voice.VoiceCommandHandler
import com.parthadae.seneschal.voice.VoiceCommandResult
import com.parthadae.seneschal.voice.VoiceUtterance
import javax.inject.Inject
import javax.inject.Provider
import javax.inject.Singleton

/**
 * "What can you do" — recites each registered handler's example phrases, so
 * help stays current automatically as features add voice support.
 *
 * Injects the handler set via [Provider] because this handler is itself a
 * member of that set (Provider breaks the dependency cycle).
 */
@Singleton
class HelpVoiceHandler @Inject constructor(
    private val allHandlers: Provider<Set<@JvmSuppressWildcards VoiceCommandHandler>>,
) : VoiceCommandHandler {
    override val priority = 40

    override val examples = listOf("What can you do")

    private val helpRegex =
        Regex("^(?:help|what can (?:you|i) (?:do|say)|what do you do|commands|list commands)$")

    override suspend fun handle(utterance: VoiceUtterance): VoiceCommandResult? {
        if (!helpRegex.matches(utterance.normalized)) return null
        return VoiceCommandResult.Success(helpSpeech())
    }

    /** Also used by [RemoteVoiceHandler] when the LLM classifies "help". */
    fun helpSpeech(): String {
        val phrases = allHandlers.get()
            .sortedBy { it.priority }
            .filter { it !== this }
            .flatMap { it.examples }
        return "You can say things like: " + phrases.joinToString(". ") + "."
    }
}
