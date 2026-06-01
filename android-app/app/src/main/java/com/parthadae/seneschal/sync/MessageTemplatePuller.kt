package com.parthadae.seneschal.sync

import com.parthadae.seneschal.data.local.MessageTemplateDao
import com.parthadae.seneschal.data.local.MessageTemplateEntity
import com.parthadae.seneschal.data.remote.SeneschalApi
import com.parthadae.seneschal.data.remote.dto.MessageTemplateDto
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Incremental pull of message templates filtered by `since = max(updatedAt)`.
 * Mirrors [ExpensePuller].
 */
@Singleton
class MessageTemplatePuller @Inject constructor(
    private val api: SeneschalApi,
    private val messageTemplateDao: MessageTemplateDao,
) : Puller {
    override suspend fun pull() {
        val since = messageTemplateDao.maxUpdatedAt()
            ?.let { Instant.ofEpochMilli(it).toString() }
        val rows = api.getMessageTemplates(since = since)
        if (rows.isNotEmpty()) {
            messageTemplateDao.upsertAll(rows.mapNotNull { it.toEntity() })
        }
    }

    private fun MessageTemplateDto.toEntity(): MessageTemplateEntity? {
        if (deletedAt == null) {
            if (title == null || body == null) return null
        }
        return MessageTemplateEntity(
            id = id,
            title = title.orEmpty(),
            body = body.orEmpty(),
            createdAt = Instant.parse(createdAt).toEpochMilli(),
            updatedAt = Instant.parse(updatedAt).toEpochMilli(),
            clientUpdatedAt = Instant.parse(clientUpdatedAt).toEpochMilli(),
            deletedAt = deletedAt?.let { Instant.parse(it).toEpochMilli() },
        )
    }
}
