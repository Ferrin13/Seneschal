package com.parthadae.seneschal.voice.commands

import com.parthadae.seneschal.voice.VoiceCommandHandler
import com.parthadae.seneschal.voice.VoiceCommandResult
import com.parthadae.seneschal.voice.VoiceUtterance
import java.time.ZonedDateTime
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Fast-path retroactive slot logging with simple grammars. Phrasings these
 * regexes can't parse ("log reading from now to an hour ago") fall through
 * the dispatcher to the LLM-backed [RemoteVoiceHandler].
 */
@Singleton
class SlotLogVoiceHandler @Inject constructor(
    private val actions: TimeTrackingVoiceActions,
    private val activityMatcher: ActivityMatcher,
) : VoiceCommandHandler {
    override val priority = 20

    override val examples = listOf(
        "Log reading from 2 to 3 pm",
        "Log the last hour as chores",
        "Clear the last 30 minutes",
    )

    private val logRangeRegex =
        Regex("^(?:log|record|mark|set) (.+?) from (.+?) (?:to|until|till) (.+)$")
    private val logLastRegex =
        Regex("^(?:log|record|mark|set) (?:the )?(?:last|past) (.+?) (?:as|to) (.+)$")
    private val logForLastRegex =
        Regex("^(?:log|record|mark|set) (.+?) for the (?:last|past) (.+)$")
    private val clearRangeRegex =
        Regex("^(?:clear|delete|erase|reset) (?:everything )?from (.+?) (?:to|until|till) (.+)$")
    private val clearLastRegex =
        Regex("^(?:clear|delete|erase|reset) (?:the )?(?:last|past) (.+)$")

    override suspend fun handle(utterance: VoiceUtterance): VoiceCommandResult? {
        val text = utterance.normalized
        logRangeRegex.matchEntire(text)?.let {
            return logRange(it.groupValues[1], it.groupValues[2], it.groupValues[3])
        }
        logLastRegex.matchEntire(text)?.let {
            return logLast(durationText = it.groupValues[1], spokenActivity = it.groupValues[2])
        }
        logForLastRegex.matchEntire(text)?.let {
            return logLast(durationText = it.groupValues[2], spokenActivity = it.groupValues[1])
        }
        clearRangeRegex.matchEntire(text)?.let {
            return clearRange(it.groupValues[1], it.groupValues[2])
        }
        clearLastRegex.matchEntire(text)?.let {
            return clearLast(it.groupValues[1])
        }
        return null
    }

    private suspend fun logRange(
        spokenActivity: String,
        startText: String,
        endText: String,
    ): VoiceCommandResult {
        val match = activityMatcher.match(spokenActivity)
        match.errorOrNull(spokenActivity)?.let { return it }
        val activity = (match as ActivityMatcher.Match.Found).activity

        val range = VoiceTimeParser.resolveRange(startText, endText, ZonedDateTime.now())
            ?: return VoiceCommandResult.Failure(
                "I couldn't understand the time range \"$startText to $endText\"."
            )
        return actions.logRange(activity, range.first, range.second)
    }

    private suspend fun logLast(
        durationText: String,
        spokenActivity: String,
    ): VoiceCommandResult {
        val match = activityMatcher.match(spokenActivity)
        match.errorOrNull(spokenActivity)?.let { return it }
        val activity = (match as ActivityMatcher.Match.Found).activity

        val durationMs = VoiceTimeParser.parseDuration(durationText)
            ?: return VoiceCommandResult.Failure(
                "I couldn't understand \"$durationText\" as a duration."
            )
        val now = System.currentTimeMillis()
        return actions.logRange(activity, now - durationMs, now)
    }

    private suspend fun clearRange(startText: String, endText: String): VoiceCommandResult {
        val range = VoiceTimeParser.resolveRange(startText, endText, ZonedDateTime.now())
            ?: return VoiceCommandResult.Failure(
                "I couldn't understand the time range \"$startText to $endText\"."
            )
        return actions.clearRange(range.first, range.second)
    }

    private suspend fun clearLast(durationText: String): VoiceCommandResult {
        val durationMs = VoiceTimeParser.parseDuration(durationText)
            ?: return VoiceCommandResult.Failure(
                "I couldn't understand \"$durationText\" as a duration."
            )
        val now = System.currentTimeMillis()
        return actions.clearRange(now - durationMs, now)
    }
}
