package com.parthadae.seneschal.voice.commands

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime

class VoiceTimeParserTest {
    private val zone = ZoneId.of("UTC")

    private fun at(hour: Int, minute: Int = 0): ZonedDateTime =
        ZonedDateTime.of(2026, 8, 14, hour, minute, 0, 0, zone)

    private fun epoch(hour: Int, minute: Int = 0): Long =
        at(hour, minute).toInstant().toEpochMilli()

    // ---- parseClockTime ----

    @Test
    fun `parses bare hour`() {
        assertEquals(
            VoiceTimeParser.ClockTime(2, 0, null),
            VoiceTimeParser.parseClockTime("2"),
        )
    }

    @Test
    fun `parses hour with minutes and meridiem`() {
        assertEquals(
            VoiceTimeParser.ClockTime(2, 30, VoiceTimeParser.Meridiem.PM),
            VoiceTimeParser.parseClockTime("2:30 pm"),
        )
    }

    @Test
    fun `parses 24h clock`() {
        assertEquals(
            VoiceTimeParser.ClockTime(14, 0, null),
            VoiceTimeParser.parseClockTime("14:00"),
        )
    }

    @Test
    fun `parses noon and midnight`() {
        assertEquals(
            VoiceTimeParser.ClockTime(12, 0, VoiceTimeParser.Meridiem.PM),
            VoiceTimeParser.parseClockTime("noon"),
        )
        assertEquals(
            VoiceTimeParser.ClockTime(12, 0, VoiceTimeParser.Meridiem.AM),
            VoiceTimeParser.parseClockTime("midnight"),
        )
    }

    @Test
    fun `rejects invalid clock strings`() {
        assertNull(VoiceTimeParser.parseClockTime("25"))
        assertNull(VoiceTimeParser.parseClockTime("2:75"))
        assertNull(VoiceTimeParser.parseClockTime("13 pm"))
        assertNull(VoiceTimeParser.parseClockTime("banana"))
    }

    // ---- resolveRange ----

    @Test
    fun `ambiguous range in the afternoon resolves to pm`() {
        // At 5 pm, "from 2 to 3" means 2-3 pm.
        val range = VoiceTimeParser.resolveRange("2", "3", at(17))
        assertEquals(epoch(14) to epoch(15), range)
    }

    @Test
    fun `ambiguous range before it could mean pm resolves to am`() {
        // At 1 pm, 2 pm hasn't started, so "from 2 to 3" means 2-3 am.
        val range = VoiceTimeParser.resolveRange("2", "3", at(13))
        assertEquals(epoch(2) to epoch(3), range)
    }

    @Test
    fun `in-progress pm range is preferred over fully past am range`() {
        // At 2:30 pm, "from 2 to 3" means the 2-3 pm block that just started.
        val range = VoiceTimeParser.resolveRange("2", "3", at(14, 30))
        assertEquals(epoch(14) to epoch(15), range)
    }

    @Test
    fun `explicit meridiem is honored even in the future`() {
        val range = VoiceTimeParser.resolveRange("2 pm", "3 pm", at(9))
        assertEquals(epoch(14) to epoch(15), range)
    }

    @Test
    fun `range spanning noon resolves sensibly`() {
        // At 2 pm, "from 11 to 1" means 11 am to 1 pm.
        val range = VoiceTimeParser.resolveRange("11", "1", at(14))
        assertEquals(epoch(11) to epoch(13), range)
    }

    @Test
    fun `unparseable range returns null`() {
        assertNull(VoiceTimeParser.resolveRange("banana", "3", at(14)))
        assertNull(VoiceTimeParser.resolveRange("2", "banana", at(14)))
    }

    // ---- parseDuration ----

    @Test
    fun `parses common durations`() {
        assertEquals(30L * 60_000, VoiceTimeParser.parseDuration("30 minutes"))
        assertEquals(60L * 60_000, VoiceTimeParser.parseDuration("an hour"))
        assertEquals(60L * 60_000, VoiceTimeParser.parseDuration("hour"))
        assertEquals(90L * 60_000, VoiceTimeParser.parseDuration("hour and a half"))
        assertEquals(30L * 60_000, VoiceTimeParser.parseDuration("half an hour"))
        assertEquals(120L * 60_000, VoiceTimeParser.parseDuration("2 hours"))
        assertEquals(120L * 60_000, VoiceTimeParser.parseDuration("two hours"))
        assertEquals(75L * 60_000, VoiceTimeParser.parseDuration("one hour and 15 minutes"))
        assertEquals(45L * 60_000, VoiceTimeParser.parseDuration("forty five minutes"))
    }

    @Test
    fun `rejects unparseable durations`() {
        assertNull(VoiceTimeParser.parseDuration("banana"))
        assertNull(VoiceTimeParser.parseDuration(""))
    }
}
