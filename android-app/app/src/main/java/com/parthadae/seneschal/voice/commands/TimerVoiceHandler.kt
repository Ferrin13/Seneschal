package com.parthadae.seneschal.voice.commands

import com.parthadae.seneschal.voice.VoiceCommandHandler
import com.parthadae.seneschal.voice.VoiceCommandResult
import com.parthadae.seneschal.voice.VoiceUtterance
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Fast-path timer control: start/stop tracking and report what's running.
 * Utterances that don't match these grammars (or fail inside them) fall
 * through the dispatcher to the LLM-backed [RemoteVoiceHandler].
 */
@Singleton
class TimerVoiceHandler @Inject constructor(
    private val actions: TimeTrackingVoiceActions,
    private val activityMatcher: ActivityMatcher,
) : VoiceCommandHandler {
    override val priority = 10

    override val examples = listOf(
        "Start tracking reading",
        "Stop the timer",
        "What am I tracking",
    )

    private val bareStartRegex =
        Regex("^(?:start|begin)(?: the)? (?:timer|clock|tracking)$")

    // Ordered most-specific first; the "start <anything>" catch-all comes last
    // so phrasings like "start tracking reading" bind correctly.
    private val startPatterns = listOf(
        Regex("^(?:start|begin)(?: the)? (?:timer|clock) (?:for|on) (.+)$"),
        Regex("^(?:start|begin) tracking (.+)$"),
        Regex("^track (.+)$"),
        Regex("^(?:start|begin) (.+)$"),
    )

    private val stopRegex =
        Regex("^(?:stop|end)(?: (?:the )?(?:timer|clock|tracking)| it)?$")

    private val statusRegex = Regex(
        "^(?:what am i tracking|what are you tracking|is the timer running" +
            "|timer status|whats the timer(?: at)?|whats being tracked)$"
    )

    override suspend fun handle(utterance: VoiceUtterance): VoiceCommandResult? {
        val text = utterance.normalized
        if (bareStartRegex.matches(text)) {
            return VoiceCommandResult.Failure(
                "What should I track? Try \"start tracking\" followed by an activity."
            )
        }
        if (stopRegex.matches(text)) return actions.stopTimer()
        if (statusRegex.matches(text)) return actions.timerStatus()
        for (pattern in startPatterns) {
            pattern.matchEntire(text)?.let { return startTimer(it.groupValues[1]) }
        }
        return null
    }

    private suspend fun startTimer(spokenActivity: String): VoiceCommandResult {
        val match = activityMatcher.match(spokenActivity)
        match.errorOrNull(spokenActivity)?.let { return it }
        return actions.startTimer((match as ActivityMatcher.Match.Found).activity)
    }
}
