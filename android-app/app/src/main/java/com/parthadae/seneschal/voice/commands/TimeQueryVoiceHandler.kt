package com.parthadae.seneschal.voice.commands

import com.parthadae.seneschal.voice.VoiceCommandHandler
import com.parthadae.seneschal.voice.VoiceCommandResult
import com.parthadae.seneschal.voice.VoiceUtterance
import java.time.LocalDate
import javax.inject.Inject
import javax.inject.Singleton

/** Fast-path day summaries: "what did I do today / yesterday". */
@Singleton
class TimeQueryVoiceHandler @Inject constructor(
    private val actions: TimeTrackingVoiceActions,
) : VoiceCommandHandler {
    override val priority = 30

    override val examples = listOf(
        "What did I do today",
        "What did I do yesterday",
    )

    private val summaryRegex = Regex(
        "^(?:what did i do|what have i done|summarize|summarise|recap)" +
            "(?: my)?(?: day| time)?(?: (today|yesterday))?$"
    )

    override suspend fun handle(utterance: VoiceUtterance): VoiceCommandResult? {
        val m = summaryRegex.matchEntire(utterance.normalized) ?: return null
        val date = if (m.groupValues[1] == "yesterday") {
            LocalDate.now().minusDays(1)
        } else {
            LocalDate.now()
        }
        return actions.daySummary(date)
    }
}
