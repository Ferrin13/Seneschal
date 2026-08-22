package com.parthadae.seneschal.voice.commands

import java.time.ZonedDateTime

/**
 * Parses the time expressions that show up in spoken commands: clock times
 * ("2", "2:30 pm", "noon"), ranges ("from 2 to 3:30 pm"), and durations
 * ("30 minutes", "an hour and a half").
 *
 * Pure functions over normalized (lowercase, no punctuation) text so the
 * heuristics are unit-testable.
 */
object VoiceTimeParser {
    enum class Meridiem { AM, PM }

    data class ClockTime(val hour: Int, val minute: Int, val meridiem: Meridiem?)

    private val clockRegex = Regex("^(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?$")

    fun parseClockTime(text: String): ClockTime? {
        when (text.trim()) {
            "noon", "midday" -> return ClockTime(12, 0, Meridiem.PM)
            "midnight" -> return ClockTime(12, 0, Meridiem.AM)
        }
        val m = clockRegex.matchEntire(text.trim()) ?: return null
        val hour = m.groupValues[1].toInt()
        val minute = m.groupValues[2].ifEmpty { "0" }.toInt()
        if (minute !in 0..59) return null
        val meridiem = when (m.groupValues[3]) {
            "am" -> Meridiem.AM
            "pm" -> Meridiem.PM
            else -> null
        }
        return when {
            meridiem != null && hour in 1..12 -> ClockTime(hour, minute, meridiem)
            meridiem == null && hour in 0..23 -> ClockTime(hour, minute, null)
            else -> null
        }
    }

    /**
     * Resolve "from [startText] to [endText]" into a concrete epoch-ms range
     * on the current day.
     *
     * When am/pm is not spoken it's ambiguous ("from 2 to 3"), so we pick the
     * candidate whose start most recently began: people log time they just
     * lived, so at 5 pm "2 to 3" means 2-3 pm, while at 1 pm it means 2-3 am.
     * If no candidate has started yet, the earliest upcoming one wins.
     */
    fun resolveRange(startText: String, endText: String, now: ZonedDateTime): Pair<Long, Long>? {
        val start = parseClockTime(startText) ?: return null
        val end = parseClockTime(endText) ?: return null
        val date = now.toLocalDate()
        val nowMs = now.toInstant().toEpochMilli()

        data class Candidate(val startMs: Long, val endMs: Long)
        val candidates = mutableListOf<Candidate>()
        for (startHour in hourCandidates(start)) {
            for (endHour in hourCandidates(end)) {
                val s = date.atTime(startHour, start.minute).atZone(now.zone).toInstant().toEpochMilli()
                val e = date.atTime(endHour, end.minute).atZone(now.zone).toInstant().toEpochMilli()
                if (e > s) candidates.add(Candidate(s, e))
            }
        }
        if (candidates.isEmpty()) return null

        val started = candidates.filter { it.startMs <= nowMs }
        val pick = started.maxWithOrNull(
            // Latest start; among equal starts prefer the shortest span.
            compareBy<Candidate> { it.startMs }.thenByDescending { it.endMs }
        ) ?: candidates.minWithOrNull(compareBy({ it.startMs }, { it.endMs }))!!
        return pick.startMs to pick.endMs
    }

    /** Possible 24h hours for a spoken clock time. */
    private fun hourCandidates(t: ClockTime): List<Int> = when {
        t.meridiem == Meridiem.AM -> listOf(t.hour % 12)
        t.meridiem == Meridiem.PM -> listOf(t.hour % 12 + 12)
        t.hour == 0 || t.hour > 12 -> listOf(t.hour)
        t.hour == 12 -> listOf(12, 0)
        else -> listOf(t.hour, t.hour + 12)
    }

    private val wordNumbers = mapOf(
        "a" to 1, "an" to 1, "one" to 1, "two" to 2, "three" to 3, "four" to 4,
        "five" to 5, "six" to 6, "seven" to 7, "eight" to 8, "nine" to 9,
        "ten" to 10, "eleven" to 11, "twelve" to 12, "fifteen" to 15,
        "twenty" to 20, "thirty" to 30, "forty" to 40, "forty five" to 45,
        "fifty" to 50, "sixty" to 60, "ninety" to 90,
    )

    private val durationRegex =
        Regex("^(?:(.+?)\\s*(?:hours?|hrs?))?\\s*(?:and\\s+)?(?:(.+?)\\s*(?:minutes?|mins?))?$")

    /** "30 minutes", "an hour", "hour and a half", "2 hours" -> milliseconds. */
    fun parseDuration(text: String): Long? {
        val cleaned = text.trim().replace("-", " ").replace(Regex("\\s+"), " ")
        when (cleaned) {
            "half an hour", "half hour", "a half hour" -> return 30 * MINUTE_MS
            "hour and a half", "an hour and a half", "one and a half hours" -> return 90 * MINUTE_MS
            "hour", "the hour" -> return 60 * MINUTE_MS
        }
        val m = durationRegex.matchEntire(cleaned) ?: return null
        val hoursText = m.groupValues[1].trim()
        val minutesText = m.groupValues[2].trim()
        if (hoursText.isEmpty() && minutesText.isEmpty()) return null
        val hours = if (hoursText.isEmpty()) 0 else parseNumber(hoursText) ?: return null
        val minutes = if (minutesText.isEmpty()) 0 else parseNumber(minutesText) ?: return null
        val totalMinutes = hours * 60 + minutes
        return if (totalMinutes in 1..(24 * 60)) totalMinutes * MINUTE_MS else null
    }

    private fun parseNumber(text: String): Int? =
        text.toIntOrNull() ?: wordNumbers[text]

    private const val MINUTE_MS = 60_000L
}
