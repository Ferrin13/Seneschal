package com.parthadae.seneschal.domain

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** Slot length in milliseconds (15 minutes). */
const val SLOT_MS: Long = 15L * 60L * 1000L

/** Round an instant down to the nearest 15-minute slot boundary in UTC. */
fun floorToSlot(epochMs: Long): Long = epochMs - (epochMs % SLOT_MS)

/** Slots whose midpoints fall inside `[startMs, endMs)`. Used by timer stop. */
fun slotsCoveredByMidpoint(startMs: Long, endMs: Long): List<Long> {
    if (endMs <= startMs) return emptyList()
    val first = floorToSlot(startMs)
    val out = mutableListOf<Long>()
    var t = first
    while (t < endMs) {
        val mid = t + SLOT_MS / 2
        if (mid in startMs until endMs) out.add(t)
        t += SLOT_MS
    }
    return out
}

/** Inclusive list of slot starts spanning [from, to] in 15-min steps. */
fun slotsBetween(fromMs: Long, toMs: Long): List<Long> {
    if (toMs < fromMs) return emptyList()
    val start = floorToSlot(fromMs)
    val end = floorToSlot(toMs)
    val out = ArrayList<Long>(((end - start) / SLOT_MS).toInt() + 1)
    var t = start
    while (t <= end) {
        out.add(t)
        t += SLOT_MS
    }
    return out
}

/** All 96 slots of a calendar day in the given zone. */
fun slotsForDay(date: LocalDate, zone: ZoneId = ZoneId.systemDefault()): List<Long> {
    val startInstant = date.atStartOfDay(zone).toInstant().toEpochMilli()
    val endInstant = date.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
    return slotsBetween(startInstant, endInstant - SLOT_MS)
}

/** Convert epoch ms (slot start in UTC) to ISO-8601 string for the API. */
fun Long.toIsoString(): String = Instant.ofEpochMilli(this).toString()
