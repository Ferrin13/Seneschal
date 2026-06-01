package com.parthadae.seneschal.data.repository

import com.parthadae.seneschal.data.local.MessageTemplateDao
import com.parthadae.seneschal.data.local.MessageTemplateEntity
import com.parthadae.seneschal.data.local.PendingMutationDao
import com.parthadae.seneschal.data.local.PendingMutationEntity
import com.parthadae.seneschal.data.remote.dto.MessageTemplateUpsertDto
import com.parthadae.seneschal.domain.MessageTemplate
import com.parthadae.seneschal.domain.toDomain
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
 * Offline-first store for the user's reusable message bodies. Same shape
 * as [ExpenseRepository]: write Room, enqueue an outbox row, kick the
 * sync worker. Deletes hard-delete locally and enqueue a tombstone with
 * `deleted = true` so the server soft-deletes the row.
 */
@OptIn(ExperimentalStdlibApi::class)
@Singleton
class MessageTemplateRepository @Inject constructor(
    private val messageTemplateDao: MessageTemplateDao,
    private val pendingMutationDao: PendingMutationDao,
    private val syncScheduler: SyncScheduler,
    moshi: Moshi,
) {
    private val upsertAdapter = moshi.adapter<MessageTemplateUpsertDto>()

    val templates: Flow<List<MessageTemplate>> =
        messageTemplateDao.observeActive().map { list -> list.map { it.toDomain() } }

    suspend fun byId(id: String): MessageTemplate? =
        messageTemplateDao.byId(id)?.toDomain()

    suspend fun upsert(
        id: String = UUID.randomUUID().toString(),
        title: String,
        body: String,
    ): String {
        val now = System.currentTimeMillis()
        val existing = messageTemplateDao.byId(id)
        val entity = MessageTemplateEntity(
            id = id,
            title = title,
            body = body,
            createdAt = existing?.createdAt ?: now,
            updatedAt = now,
            clientUpdatedAt = now,
            deletedAt = null,
        )
        messageTemplateDao.upsertAll(listOf(entity))
        enqueueUpsert(
            MessageTemplateUpsertDto(
                id = id,
                title = title,
                body = body,
                clientUpdatedAt = Instant.ofEpochMilli(now).toString(),
            )
        )
        return id
    }

    suspend fun delete(id: String) {
        val now = System.currentTimeMillis()
        messageTemplateDao.deleteById(id)
        enqueueUpsert(
            MessageTemplateUpsertDto(
                id = id,
                title = null,
                body = null,
                clientUpdatedAt = Instant.ofEpochMilli(now).toString(),
                deleted = true,
            )
        )
    }

    private suspend fun enqueueUpsert(dto: MessageTemplateUpsertDto) {
        pendingMutationDao.insert(
            PendingMutationEntity(
                kind = KIND_TEMPLATE_UPSERT,
                targetId = dto.id,
                payloadJson = upsertAdapter.toJson(dto),
                createdAt = System.currentTimeMillis(),
            )
        )
        syncScheduler.requestImmediateSync()
    }

    companion object {
        const val KIND_TEMPLATE_UPSERT = "template_upsert"
    }
}
