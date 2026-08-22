package com.parthadae.seneschal.voice

import android.util.Log
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Routes a recognized transcript to the first [VoiceCommandHandler] that
 * claims it. Handlers are contributed via Hilt set multibindings (see
 * [com.parthadae.seneschal.di.VoiceModule]) and consulted in [VoiceCommandHandler.priority]
 * order, so feature modules can add commands without touching this class.
 */
@Singleton
class VoiceCommandDispatcher @Inject constructor(
    handlers: Set<@JvmSuppressWildcards VoiceCommandHandler>,
) {
    private val orderedHandlers = handlers.sortedBy { it.priority }

    /**
     * A [VoiceCommandResult.Success] wins immediately. Failures don't stop
     * the chain: a regex handler that claimed an utterance but couldn't parse
     * it ("log reading from now to an hour ago") falls through to the
     * LLM-backed remote handler, which usually can. If everything failed we
     * speak the last non-transient failure — typically the most informed one
     * (the LLM's) — falling back to transient messages only when that's all
     * there is (e.g. offline).
     */
    suspend fun dispatch(rawTranscript: String): VoiceCommandResult {
        val utterance = VoiceUtterance(raw = rawTranscript, normalized = normalize(rawTranscript))
        if (utterance.normalized.isBlank()) {
            return VoiceCommandResult.Failure("I didn't catch that.")
        }
        val failures = mutableListOf<VoiceCommandResult.Failure>()
        for (handler in orderedHandlers) {
            val result = try {
                handler.handle(utterance)
            } catch (e: Exception) {
                Log.e(TAG, "Voice handler ${handler.javaClass.simpleName} threw", e)
                failures.add(
                    VoiceCommandResult.Failure(
                        "Something went wrong running that command.",
                        transient = true,
                    )
                )
                continue
            }
            when (result) {
                is VoiceCommandResult.Success -> return result
                is VoiceCommandResult.Failure -> failures.add(result)
                null -> {}
            }
        }
        return failures.lastOrNull { !it.transient }
            ?: failures.lastOrNull()
            ?: VoiceCommandResult.Failure(
                "Sorry, I don't know how to \"$rawTranscript\" yet. Say \"what can you do\" to hear examples."
            )
    }

    private fun normalize(raw: String): String =
        raw.lowercase()
            .replace(Regex("[\u2019']"), "") // what's -> whats
            .replace(Regex("[.,!?\u201C\u201D\"]"), " ") // p.m. -> p m
            .replace(Regex("\\b([ap]) m\\b"), "$1m") // p m -> pm
            .replace(Regex("\\s+"), " ")
            .trim()
            .replace(Regex("^(?:hey |ok )?seneschal\\b\\s*"), "")
            .replace(Regex("^please\\s+"), "")
            .replace(Regex("\\s+please$"), "")
            .trim()

    private companion object {
        const val TAG = "VoiceCommandDispatcher"
    }
}
