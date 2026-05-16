package com.parthadae.seneschal.sync

import com.parthadae.seneschal.data.local.PendingMutationDao
import com.parthadae.seneschal.data.local.PendingMutationEntity
import com.parthadae.seneschal.data.remote.SeneschalApi
import com.parthadae.seneschal.data.remote.dto.SlotsUpsertRequest
import com.parthadae.seneschal.data.remote.dto.TimeSlotUpsertDto
import com.parthadae.seneschal.data.repository.TimeSlotRepository
import com.squareup.moshi.Moshi
import com.squareup.moshi.adapter
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Pushes queued [TimeSlotUpsertDto]s to `PUT /slots` in one bulk request.
 * The server applies last-write-wins by `clientUpdatedAt`, so we don't have
 * to reorder client-side.
 */
@OptIn(ExperimentalStdlibApi::class)
@Singleton
class SlotUpsertOutboxHandler @Inject constructor(
    private val api: SeneschalApi,
    private val pendingMutationDao: PendingMutationDao,
    moshi: Moshi,
) : OutboxHandler {
    private val adapter = moshi.adapter<TimeSlotUpsertDto>()

    override val kind: String = TimeSlotRepository.KIND_SLOT_UPSERT

    override suspend fun push(rows: List<PendingMutationEntity>) {
        if (rows.isEmpty()) return
        val payload = rows.mapNotNull {
            runCatching { adapter.fromJson(it.payloadJson) }.getOrNull()
        }
        if (payload.isNotEmpty()) {
            api.upsertSlots(SlotsUpsertRequest(payload))
        }
        rows.forEach { pendingMutationDao.delete(it.id) }
    }

    override fun describe(row: PendingMutationEntity, ctx: DescribeContext): String {
        val parsed = runCatching { adapter.fromJson(row.payloadJson) }.getOrNull()
            ?: return "Slot change (${row.targetId ?: "?"})"
        val timeLabel = formatSlotLabel(parsed.slotStartUtc)
        val verb = if (parsed.deleted == true) "Clear" else "Set"
        val activityName = parsed.primaryActivityId
            ?.let { ctx.activitiesById[it]?.name ?: "(unknown activity)" }
        return buildString {
            append("$verb $timeLabel")
            if (activityName != null) append(" → $activityName")
        }
    }

    companion object {
        private val SLOT_TIME_FMT = DateTimeFormatter.ofPattern("h:mm a")
        private val DAY_FMT = DateTimeFormatter.ofPattern("EEE MMM d")

        private fun formatSlotLabel(iso: String): String = runCatching {
            val zoned = Instant.parse(iso).atZone(ZoneId.systemDefault())
            val today = LocalDate.now()
            val dayPart = when (zoned.toLocalDate()) {
                today -> "Today"
                today.minusDays(1) -> "Yesterday"
                today.plusDays(1) -> "Tomorrow"
                else -> DAY_FMT.format(zoned)
            }
            "$dayPart ${SLOT_TIME_FMT.format(zoned)}"
        }.getOrElse { iso }
    }
}
