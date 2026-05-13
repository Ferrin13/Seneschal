package com.parthadae.seneschal.data.repository

import android.content.Context
import com.parthadae.seneschal.data.local.PendingMutationDao
import com.parthadae.seneschal.data.local.PendingMutationEntity
import com.parthadae.seneschal.data.local.RunningTimerDao
import com.parthadae.seneschal.data.local.RunningTimerEntity
import com.parthadae.seneschal.data.local.TimeSlotDao
import com.parthadae.seneschal.data.local.TimeSlotEntity
import com.parthadae.seneschal.data.remote.SeneschalApi
import com.parthadae.seneschal.data.remote.dto.TimeSlotUpsertDto
import com.parthadae.seneschal.data.remote.dto.TimerStartRequest
import com.parthadae.seneschal.data.remote.dto.TimerStopRequest
import com.parthadae.seneschal.domain.RunningTimer
import com.parthadae.seneschal.domain.slotsCoveredByMidpoint
import com.parthadae.seneschal.domain.toIsoString
import com.parthadae.seneschal.sync.SyncScheduler
import com.parthadae.seneschal.timer.TimerForegroundService
import com.squareup.moshi.Moshi
import com.squareup.moshi.adapter
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Timer state lives both locally (instant feedback for the foreground
 * service / FAB) and on the server (so other devices stay in sync).
 *
 * Start/stop call the API directly; on success we update Room. If the
 * server call fails we still update Room (offline) and the next sync pass
 * will reconcile. (For v1, timer offline support is best-effort.)
 */
@OptIn(ExperimentalStdlibApi::class)
@Singleton
class TimerRepository @Inject constructor(
    @ApplicationContext private val appContext: Context,
    private val runningTimerDao: RunningTimerDao,
    private val timeSlotDao: TimeSlotDao,
    private val pendingMutationDao: PendingMutationDao,
    private val syncScheduler: SyncScheduler,
    private val api: SeneschalApi,
    moshi: Moshi,
) {
    private val upsertAdapter = moshi.adapter<TimeSlotUpsertDto>()

    val timer: Flow<RunningTimer?> = runningTimerDao.observe().map { row ->
        row?.let {
            RunningTimer(
                primaryActivityId = it.primaryActivityId,
                secondaryActivityId = it.secondaryActivityId,
                notes = it.notes,
                startedAtMs = it.startedAtMs,
            )
        }
    }

    suspend fun start(
        primaryActivityId: String,
        secondaryActivityId: String? = null,
        notes: String? = null,
        startedAtMs: Long = System.currentTimeMillis(),
    ) {
        runningTimerDao.upsert(
            RunningTimerEntity(
                primaryActivityId = primaryActivityId,
                secondaryActivityId = secondaryActivityId,
                notes = notes,
                startedAtMs = startedAtMs,
            )
        )
        TimerForegroundService.start(appContext)
        runCatching {
            api.startTimer(
                TimerStartRequest(
                    primaryActivityId = primaryActivityId,
                    secondaryActivityId = secondaryActivityId,
                    notes = notes,
                    startedAt = startedAtMs.toIsoString(),
                )
            )
        }
    }

    suspend fun stop(stoppedAtMs: Long = System.currentTimeMillis()) {
        val active = runningTimerDao.current() ?: return
        runningTimerDao.clear()

        val response = runCatching {
            api.stopTimer(TimerStopRequest(stoppedAt = stoppedAtMs.toIsoString()))
        }.getOrNull()

        if (response != null && response.isSuccessful && response.body() != null) {
            // Trust the server's slot list, mirror into Room.
            val now = System.currentTimeMillis()
            val rows = response.body()!!.slots.map { dto ->
                TimeSlotEntity(
                    slotStartUtcMs = java.time.Instant.parse(dto.slotStartUtc).toEpochMilli(),
                    primaryActivityId = dto.primaryActivityId,
                    secondaryActivityId = dto.secondaryActivityId,
                    notes = dto.notes,
                    updatedAt = now,
                    clientUpdatedAt = java.time.Instant.parse(dto.clientUpdatedAt).toEpochMilli(),
                    deletedAt = dto.deletedAt?.let { java.time.Instant.parse(it).toEpochMilli() },
                )
            }
            if (rows.isNotEmpty()) timeSlotDao.upsertAll(rows)
        } else {
            // Offline / error: compute the same slot set locally so the user
            // sees their data immediately. Sync will reconcile later.
            val covered = slotsCoveredByMidpoint(active.startedAtMs, stoppedAtMs)
            val now = System.currentTimeMillis()
            val rows = covered.map { slotStart ->
                TimeSlotEntity(
                    slotStartUtcMs = slotStart,
                    primaryActivityId = active.primaryActivityId,
                    secondaryActivityId = active.secondaryActivityId,
                    notes = active.notes,
                    updatedAt = now,
                    clientUpdatedAt = now,
                    deletedAt = null,
                )
            }
            if (rows.isNotEmpty()) timeSlotDao.upsertAll(rows)
        }
    }

    /**
     * Materialize every fully-covered slot of an in-progress timer into
     * Room (and the outbox) so the user sees the run on the Today screen
     * without having to stop the timer first.
     *
     * Uses the same midpoint-coverage rule as `/timer/stop`, so when the
     * user does eventually stop, the stop call's writes match what was
     * already backfilled (LWW with the stop's `clientUpdatedAt` as the
     * tiebreaker).
     *
     * Cheap to call repeatedly: it skips slots whose primary/secondary/
     * notes already match what we'd write.
     */
    suspend fun backfillCoveredSlots(nowMs: Long = System.currentTimeMillis()) {
        val active = runningTimerDao.current() ?: return
        val covered = slotsCoveredByMidpoint(active.startedAtMs, nowMs)
        if (covered.isEmpty()) return

        val existing = timeSlotDao
            .findByStarts(covered)
            .associateBy { it.slotStartUtcMs }

        val toWrite = mutableListOf<TimeSlotEntity>()
        val toEnqueue = mutableListOf<TimeSlotUpsertDto>()
        for (slotStart in covered) {
            val current = existing[slotStart]
            val sameAsTimer = current != null &&
                current.primaryActivityId == active.primaryActivityId &&
                current.secondaryActivityId == active.secondaryActivityId &&
                current.notes == active.notes &&
                current.deletedAt == null
            if (sameAsTimer) continue

            toWrite.add(
                TimeSlotEntity(
                    slotStartUtcMs = slotStart,
                    primaryActivityId = active.primaryActivityId,
                    secondaryActivityId = active.secondaryActivityId,
                    notes = active.notes,
                    updatedAt = nowMs,
                    clientUpdatedAt = nowMs,
                    deletedAt = null,
                )
            )
            toEnqueue.add(
                TimeSlotUpsertDto(
                    slotStartUtc = slotStart.toIsoString(),
                    primaryActivityId = active.primaryActivityId,
                    secondaryActivityId = active.secondaryActivityId,
                    notes = active.notes,
                    clientUpdatedAt = nowMs.toIsoString(),
                )
            )
        }

        if (toWrite.isEmpty()) return
        timeSlotDao.upsertAll(toWrite)
        toEnqueue.forEach { dto ->
            pendingMutationDao.insert(
                PendingMutationEntity(
                    kind = TimeSlotRepository.KIND_SLOT_UPSERT,
                    targetId = dto.slotStartUtc,
                    payloadJson = upsertAdapter.toJson(dto),
                    createdAt = nowMs,
                )
            )
        }
        syncScheduler.requestImmediateSync()
    }
}
