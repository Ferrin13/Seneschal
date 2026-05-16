package com.parthadae.seneschal.data.repository

import com.parthadae.seneschal.data.local.ExpenseDao
import com.parthadae.seneschal.data.local.ExpenseEntity
import com.parthadae.seneschal.data.local.PendingMutationDao
import com.parthadae.seneschal.data.local.PendingMutationEntity
import com.parthadae.seneschal.data.remote.dto.ExpenseUpsertDto
import com.parthadae.seneschal.domain.Expense
import com.parthadae.seneschal.domain.toDomain
import com.parthadae.seneschal.sync.ImageAttacher
import com.parthadae.seneschal.sync.SyncScheduler
import com.squareup.moshi.Moshi
import com.squareup.moshi.adapter
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import java.time.Instant
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Offline-first expense store. Reads come from Room. Writes:
 *
 * 1. Insert/update Room (stamping `clientUpdatedAt = now`).
 * 2. Enqueue an `expense_upsert` mutation in the outbox.
 * 3. Kick the sync worker.
 *
 * If an image is being attached at the same time, the caller separately
 * passes the local file path; this repo records it on the row but the
 * actual S3 upload is the [com.parthadae.seneschal.sync.ImageRepository]'s
 * job. After upload succeeds, [attach] is called via the [ImageAttacher]
 * dispatch and we enqueue a follow-up `expense_upsert` carrying the new
 * image key.
 */
@OptIn(ExperimentalStdlibApi::class)
@Singleton
class ExpenseRepository @Inject constructor(
    private val expenseDao: ExpenseDao,
    private val pendingMutationDao: PendingMutationDao,
    private val syncScheduler: SyncScheduler,
    moshi: Moshi,
) : ImageAttacher {
    private val upsertAdapter = moshi.adapter<ExpenseUpsertDto>()

    val expenses: Flow<List<Expense>> = expenseDao.observeActive().map { list ->
        list.map { it.toDomain() }
    }

    suspend fun byId(id: String): Expense? = expenseDao.byId(id)?.toDomain()

    /**
     * Create or update an expense. Pass [localImagePath] only when a fresh
     * image is being attached; the caller is responsible for separately
     * enqueuing the image upload via `ImageRepository.enqueueUpload`.
     */
    suspend fun upsert(
        id: String = UUID.randomUUID().toString(),
        businessId: String,
        occurredAt: Instant,
        amountCents: Int? = null,
        note: String? = null,
        imageKey: String? = null,
        localImagePath: String? = null,
    ): String {
        val now = System.currentTimeMillis()
        val existing = expenseDao.byId(id)
        val entity = ExpenseEntity(
            id = id,
            businessId = businessId,
            occurredAtMs = occurredAt.toEpochMilli(),
            amountCents = amountCents,
            note = note,
            imageKey = imageKey ?: existing?.imageKey,
            localImagePath = localImagePath ?: existing?.localImagePath,
            createdAt = existing?.createdAt ?: now,
            updatedAt = now,
            clientUpdatedAt = now,
            deletedAt = null,
        )
        expenseDao.upsertAll(listOf(entity))
        enqueueUpsert(
            ExpenseUpsertDto(
                id = id,
                businessId = businessId,
                occurredAt = occurredAt.toString(),
                amountCents = amountCents,
                note = note,
                imageKey = entity.imageKey,
                clientUpdatedAt = Instant.ofEpochMilli(now).toString(),
            )
        )
        return id
    }

    suspend fun delete(id: String) {
        val now = System.currentTimeMillis()
        expenseDao.deleteById(id)
        enqueueUpsert(
            ExpenseUpsertDto(
                id = id,
                businessId = null,
                occurredAt = null,
                amountCents = null,
                note = null,
                imageKey = null,
                clientUpdatedAt = Instant.ofEpochMilli(now).toString(),
                deleted = true,
            )
        )
    }

    override val ownerKind: String = OWNER_KIND

    override suspend fun attach(ownerId: String, imageKey: String) {
        val row = expenseDao.byId(ownerId) ?: return
        // A late upload must not resurrect a row the user has since deleted.
        if (row.deletedAt != null) return
        val now = System.currentTimeMillis()
        expenseDao.setImage(
            id = ownerId,
            imageKey = imageKey,
            localImagePath = null,
            updatedAt = now,
            clientUpdatedAt = now,
        )
        enqueueUpsert(
            ExpenseUpsertDto(
                id = ownerId,
                businessId = row.businessId,
                occurredAt = Instant.ofEpochMilli(row.occurredAtMs).toString(),
                amountCents = row.amountCents,
                note = row.note,
                imageKey = imageKey,
                clientUpdatedAt = Instant.ofEpochMilli(now).toString(),
            )
        )
    }

    private suspend fun enqueueUpsert(dto: ExpenseUpsertDto) {
        pendingMutationDao.insert(
            PendingMutationEntity(
                kind = KIND_EXPENSE_UPSERT,
                targetId = dto.id,
                payloadJson = upsertAdapter.toJson(dto),
                createdAt = System.currentTimeMillis(),
            )
        )
        syncScheduler.requestImmediateSync()
    }

    companion object {
        const val KIND_EXPENSE_UPSERT = "expense_upsert"
        const val OWNER_KIND = "expense"
    }
}
