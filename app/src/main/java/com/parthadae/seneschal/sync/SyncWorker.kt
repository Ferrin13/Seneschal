package com.parthadae.seneschal.sync

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.parthadae.seneschal.auth.AuthRepository
import com.parthadae.seneschal.data.local.ActivityDao
import com.parthadae.seneschal.data.local.ActivityEntity
import com.parthadae.seneschal.data.local.CategoryDao
import com.parthadae.seneschal.data.local.CategoryEntity
import com.parthadae.seneschal.data.local.PendingMutationDao
import com.parthadae.seneschal.data.local.PendingMutationEntity
import com.parthadae.seneschal.data.local.TimeSlotDao
import com.parthadae.seneschal.data.local.TimeSlotEntity
import com.parthadae.seneschal.data.remote.SeneschalApi
import com.parthadae.seneschal.data.remote.dto.ActivityDto
import com.parthadae.seneschal.data.remote.dto.CategoryDto
import com.parthadae.seneschal.data.remote.dto.SlotsUpsertRequest
import com.parthadae.seneschal.data.remote.dto.TimeSlotDto
import com.parthadae.seneschal.data.remote.dto.TimeSlotUpsertDto
import com.parthadae.seneschal.data.repository.TimeSlotRepository
import com.squareup.moshi.Moshi
import com.squareup.moshi.adapter
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import java.time.Instant

@OptIn(ExperimentalStdlibApi::class)
@HiltWorker
class SyncWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted params: WorkerParameters,
    private val authRepository: AuthRepository,
    private val api: SeneschalApi,
    private val pendingMutationDao: PendingMutationDao,
    private val categoryDao: CategoryDao,
    private val activityDao: ActivityDao,
    private val timeSlotDao: TimeSlotDao,
    private val moshi: Moshi,
    private val syncStatusRepository: SyncStatusRepository,
) : CoroutineWorker(appContext, params) {

    private val slotUpsertAdapter = moshi.adapter<TimeSlotUpsertDto>()

    override suspend fun doWork(): Result {
        if (authRepository.currentIdToken() == null) {
            // No user signed in; nothing to sync. Don't churn retries.
            return Result.success()
        }
        syncStatusRepository.markStarted()
        return try {
            // /me ensures the user row exists & defaults are seeded.
            api.getMe()
            pushOutbox()
            pullCategoriesAndActivities()
            pullSlots()
            syncStatusRepository.markSuccess()
            Result.success()
        } catch (t: Throwable) {
            android.util.Log.w("SyncWorker", "sync failed", t)
            syncStatusRepository.markFailure(t.javaClass.simpleName + ": " + (t.message ?: ""))
            if (runAttemptCount < 5) Result.retry() else Result.failure()
        }
    }

    private suspend fun pushOutbox() {
        var batch = pendingMutationDao.take(MAX_BATCH)
        while (batch.isNotEmpty()) {
            val slotMutations = batch.filter { it.kind == TimeSlotRepository.KIND_SLOT_UPSERT }
            if (slotMutations.isNotEmpty()) {
                val payload = slotMutations.mapNotNull {
                    runCatching { slotUpsertAdapter.fromJson(it.payloadJson) }.getOrNull()
                }
                if (payload.isNotEmpty()) {
                    api.upsertSlots(SlotsUpsertRequest(payload))
                }
                slotMutations.forEach { pendingMutationDao.delete(it.id) }
            }
            // Drop any unknown kinds rather than block forever.
            val unknown = batch - slotMutations.toSet()
            unknown.forEach { markFailed(it, "unknown kind: ${it.kind}") }
            batch = pendingMutationDao.take(MAX_BATCH)
        }
    }

    private suspend fun markFailed(row: PendingMutationEntity, message: String) {
        if (row.attemptCount >= 5) {
            pendingMutationDao.delete(row.id)
        } else {
            pendingMutationDao.update(
                row.copy(
                    attemptCount = row.attemptCount + 1,
                    lastAttemptAt = System.currentTimeMillis(),
                    lastError = message,
                )
            )
        }
    }

    private suspend fun pullCategoriesAndActivities() {
        val sinceCat = categoryDao.maxUpdatedAt()?.let { Instant.ofEpochMilli(it).toString() }
        val cats = api.getCategories(since = sinceCat, includeDeleted = true)
        if (cats.isNotEmpty()) categoryDao.upsertAll(cats.map { it.toEntity() })

        val sinceAct = activityDao.maxUpdatedAt()?.let { Instant.ofEpochMilli(it).toString() }
        val acts = api.getActivities(since = sinceAct, includeDeleted = true)
        if (acts.isNotEmpty()) activityDao.upsertAll(acts.map { it.toEntity() })
    }

    private suspend fun pullSlots() {
        val since = timeSlotDao.maxUpdatedAt()?.let { Instant.ofEpochMilli(it).toString() }
        val slots = api.getSlots(since = since)
        if (slots.isNotEmpty()) timeSlotDao.upsertAll(slots.map { it.toEntity() })
    }

    private fun CategoryDto.toEntity() = CategoryEntity(
        id = id,
        name = name,
        kind = kind,
        color = color,
        sortOrder = sortOrder,
        isActive = isActive,
        createdAt = Instant.parse(createdAt).toEpochMilli(),
        updatedAt = Instant.parse(updatedAt).toEpochMilli(),
        clientUpdatedAt = Instant.parse(clientUpdatedAt).toEpochMilli(),
        deletedAt = deletedAt?.let { Instant.parse(it).toEpochMilli() },
    )

    private fun ActivityDto.toEntity() = ActivityEntity(
        id = id,
        categoryId = categoryId,
        name = name,
        sortOrder = sortOrder,
        isActive = isActive,
        archivedAt = archivedAt?.let { Instant.parse(it).toEpochMilli() },
        createdAt = Instant.parse(createdAt).toEpochMilli(),
        updatedAt = Instant.parse(updatedAt).toEpochMilli(),
        clientUpdatedAt = Instant.parse(clientUpdatedAt).toEpochMilli(),
        deletedAt = deletedAt?.let { Instant.parse(it).toEpochMilli() },
    )

    private fun TimeSlotDto.toEntity() = TimeSlotEntity(
        slotStartUtcMs = Instant.parse(slotStartUtc).toEpochMilli(),
        primaryActivityId = primaryActivityId,
        secondaryActivityId = secondaryActivityId,
        notes = notes,
        updatedAt = Instant.parse(updatedAt).toEpochMilli(),
        clientUpdatedAt = Instant.parse(clientUpdatedAt).toEpochMilli(),
        deletedAt = deletedAt?.let { Instant.parse(it).toEpochMilli() },
    )

    companion object {
        private const val MAX_BATCH = 200
    }
}
