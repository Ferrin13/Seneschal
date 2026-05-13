package com.parthadae.seneschal.data.repository

import com.parthadae.seneschal.data.local.PendingMutationDao
import com.parthadae.seneschal.data.local.PendingMutationEntity
import com.parthadae.seneschal.data.local.TimeSlotDao
import com.parthadae.seneschal.data.local.TimeSlotEntity
import com.parthadae.seneschal.data.remote.dto.TimeSlotUpsertDto
import com.parthadae.seneschal.domain.SLOT_MS
import com.parthadae.seneschal.domain.TimeSlot
import com.parthadae.seneschal.domain.toDomain
import com.parthadae.seneschal.domain.toIsoString
import com.parthadae.seneschal.sync.SyncScheduler
import com.squareup.moshi.Moshi
import com.squareup.moshi.adapter
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/**
 * All slot reads come from Room (offline-first). Writes go to Room
 * synchronously then enqueue a `slot_upsert` mutation that the
 * SyncWorker will ship to the API.
 */
@OptIn(ExperimentalStdlibApi::class)
@Singleton
class TimeSlotRepository @Inject constructor(
    private val timeSlotDao: TimeSlotDao,
    private val pendingMutationDao: PendingMutationDao,
    private val syncScheduler: SyncScheduler,
    moshi: Moshi,
) {
    private val upsertAdapter = moshi.adapter<TimeSlotUpsertDto>()

    fun observeRange(fromMs: Long, toMs: Long): Flow<List<TimeSlot>> =
        timeSlotDao.observeRange(fromMs, toMs).map { list ->
            list.map { it.toDomain() }
        }

    suspend fun setSlot(
        slotStartUtcMs: Long,
        primaryActivityId: String,
        secondaryActivityId: String? = null,
        notes: String? = null,
    ) {
        val now = System.currentTimeMillis()
        timeSlotDao.upsertAll(
            listOf(
                TimeSlotEntity(
                    slotStartUtcMs = slotStartUtcMs,
                    primaryActivityId = primaryActivityId,
                    secondaryActivityId = secondaryActivityId,
                    notes = notes,
                    updatedAt = now,
                    clientUpdatedAt = now,
                    deletedAt = null,
                )
            )
        )
        enqueueUpsert(
            TimeSlotUpsertDto(
                slotStartUtc = slotStartUtcMs.toIsoString(),
                primaryActivityId = primaryActivityId,
                secondaryActivityId = secondaryActivityId,
                notes = notes,
                clientUpdatedAt = now.toIsoString(),
            )
        )
    }

    /**
     * Fill every slot in [fromMs - toMs] (inclusive of both 15-min boundaries)
     * with the given activity. Used for the "select range, set activity" flow.
     */
    suspend fun setRange(
        fromMs: Long,
        toMs: Long,
        primaryActivityId: String,
        secondaryActivityId: String? = null,
        notes: String? = null,
    ) {
        val now = System.currentTimeMillis()
        val entities = mutableListOf<TimeSlotEntity>()
        val upserts = mutableListOf<TimeSlotUpsertDto>()
        var t = fromMs
        while (t <= toMs) {
            entities.add(
                TimeSlotEntity(
                    slotStartUtcMs = t,
                    primaryActivityId = primaryActivityId,
                    secondaryActivityId = secondaryActivityId,
                    notes = notes,
                    updatedAt = now,
                    clientUpdatedAt = now,
                    deletedAt = null,
                )
            )
            upserts.add(
                TimeSlotUpsertDto(
                    slotStartUtc = t.toIsoString(),
                    primaryActivityId = primaryActivityId,
                    secondaryActivityId = secondaryActivityId,
                    notes = notes,
                    clientUpdatedAt = now.toIsoString(),
                )
            )
            t += SLOT_MS
        }
        timeSlotDao.upsertAll(entities)
        upserts.forEach { enqueueUpsert(it) }
    }

    suspend fun clearSlot(slotStartUtcMs: Long) {
        val now = System.currentTimeMillis()
        timeSlotDao.deleteByStart(slotStartUtcMs)
        enqueueUpsert(
            TimeSlotUpsertDto(
                slotStartUtc = slotStartUtcMs.toIsoString(),
                primaryActivityId = null,
                secondaryActivityId = null,
                notes = null,
                clientUpdatedAt = now.toIsoString(),
                deleted = true,
            )
        )
    }

    /**
     * Soft-delete every slot in [fromMs - toMs] (inclusive of both
     * 15-min boundaries). Mirrors `setRange` but in the "reset" direction.
     */
    suspend fun clearRange(fromMs: Long, toMs: Long) {
        val now = System.currentTimeMillis()
        var t = fromMs
        while (t <= toMs) {
            timeSlotDao.deleteByStart(t)
            enqueueUpsert(
                TimeSlotUpsertDto(
                    slotStartUtc = t.toIsoString(),
                    primaryActivityId = null,
                    secondaryActivityId = null,
                    notes = null,
                    clientUpdatedAt = now.toIsoString(),
                    deleted = true,
                )
            )
            t += SLOT_MS
        }
    }

    private suspend fun enqueueUpsert(dto: TimeSlotUpsertDto) {
        pendingMutationDao.insert(
            PendingMutationEntity(
                kind = KIND_SLOT_UPSERT,
                targetId = dto.slotStartUtc,
                payloadJson = upsertAdapter.toJson(dto),
                createdAt = System.currentTimeMillis(),
            )
        )
        syncScheduler.requestImmediateSync()
    }

    companion object {
        const val KIND_SLOT_UPSERT = "slot_upsert"
    }
}
