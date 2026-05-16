package com.parthadae.seneschal.sync

import com.parthadae.seneschal.data.local.BusinessDao
import com.parthadae.seneschal.data.local.BusinessEntity
import com.parthadae.seneschal.data.remote.SeneschalApi
import com.parthadae.seneschal.data.remote.dto.BusinessDto
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Full pull + reconcile of the seeded business list. The dataset is tiny
 * and read-only, so we re-fetch the whole thing every sync (matching the
 * [CategoryActivityPuller] strategy) and prune any local row whose id no
 * longer exists on the server.
 */
@Singleton
class BusinessPuller @Inject constructor(
    private val api: SeneschalApi,
    private val businessDao: BusinessDao,
) : Puller {
    override suspend fun pull() {
        val rows = api.getBusinesses(since = null, includeDeleted = true)
        if (rows.isNotEmpty()) businessDao.upsertAll(rows.map { it.toEntity() })
        businessDao.deleteWhereIdNotIn(rows.map { it.id })
    }

    private fun BusinessDto.toEntity() = BusinessEntity(
        id = id,
        name = name,
        sortOrder = sortOrder,
        isActive = isActive,
        createdAt = Instant.parse(createdAt).toEpochMilli(),
        updatedAt = Instant.parse(updatedAt).toEpochMilli(),
        clientUpdatedAt = Instant.parse(clientUpdatedAt).toEpochMilli(),
        deletedAt = deletedAt?.let { Instant.parse(it).toEpochMilli() },
    )
}
