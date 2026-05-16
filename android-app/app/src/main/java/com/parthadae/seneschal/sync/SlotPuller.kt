package com.parthadae.seneschal.sync

import com.parthadae.seneschal.data.local.TimeSlotDao
import com.parthadae.seneschal.data.local.TimeSlotEntity
import com.parthadae.seneschal.data.remote.SeneschalApi
import com.parthadae.seneschal.data.remote.dto.TimeSlotDto
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Incremental pull of time slots filtered by `since = max(updatedAt)` so
 * we only fetch what's changed on the server since the last successful sync.
 */
@Singleton
class SlotPuller @Inject constructor(
    private val api: SeneschalApi,
    private val timeSlotDao: TimeSlotDao,
) : Puller {
    override suspend fun pull() {
        val since = timeSlotDao.maxUpdatedAt()?.let { Instant.ofEpochMilli(it).toString() }
        val slots = api.getSlots(since = since)
        if (slots.isNotEmpty()) timeSlotDao.upsertAll(slots.map { it.toEntity() })
    }

    private fun TimeSlotDto.toEntity() = TimeSlotEntity(
        slotStartUtcMs = Instant.parse(slotStartUtc).toEpochMilli(),
        primaryActivityId = primaryActivityId,
        secondaryActivityId = secondaryActivityId,
        notes = notes,
        updatedAt = Instant.parse(updatedAt).toEpochMilli(),
        clientUpdatedAt = Instant.parse(clientUpdatedAt).toEpochMilli(),
        deletedAt = deletedAt?.let { Instant.parse(it).toEpochMilli() },
    )
}
