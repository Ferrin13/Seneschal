package com.parthadae.seneschal.voice.commands

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val clockFormat = DateTimeFormatter.ofPattern("h:mm a")

/** "2:00 PM" — for speaking slot boundaries back to the user. */
fun speakClock(epochMs: Long, zone: ZoneId = ZoneId.systemDefault()): String =
    clockFormat.format(Instant.ofEpochMilli(epochMs).atZone(zone))

/** "1 hour 15 minutes", "45 minutes", "2 hours". */
fun speakDuration(ms: Long): String {
    val totalMinutes = (ms / 60_000L).coerceAtLeast(1)
    val hours = totalMinutes / 60
    val minutes = totalMinutes % 60
    val hourPart = if (hours > 0) "$hours ${if (hours == 1L) "hour" else "hours"}" else null
    val minutePart = if (minutes > 0) "$minutes ${if (minutes == 1L) "minute" else "minutes"}" else null
    return listOfNotNull(hourPart, minutePart).joinToString(" ").ifEmpty { "less than a minute" }
}
