package com.parthadae.seneschal.sync

import com.parthadae.seneschal.data.local.GroupDao
import com.parthadae.seneschal.data.local.GroupEntity
import com.parthadae.seneschal.data.remote.SeneschalApi
import com.parthadae.seneschal.data.remote.dto.GroupDto
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Incremental pull of contact groups. Member rows are pulled separately
 * via [GroupMemberPuller] so the wire is flat.
 */
@Singleton
class GroupPuller @Inject constructor(
    private val api: SeneschalApi,
    private val groupDao: GroupDao,
) : Puller {
    override suspend fun pull() {
        val since = groupDao.maxUpdatedAt()
            ?.let { Instant.ofEpochMilli(it).toString() }
        val rows = api.getGroups(since = since)
        if (rows.isNotEmpty()) {
            groupDao.upsertAll(rows.mapNotNull { it.toEntity() })
        }
    }

    private fun GroupDto.toEntity(): GroupEntity? {
        if (deletedAt == null && name == null) return null
        return GroupEntity(
            id = id,
            name = name.orEmpty(),
            createdAt = Instant.parse(createdAt).toEpochMilli(),
            updatedAt = Instant.parse(updatedAt).toEpochMilli(),
            clientUpdatedAt = Instant.parse(clientUpdatedAt).toEpochMilli(),
            deletedAt = deletedAt?.let { Instant.parse(it).toEpochMilli() },
        )
    }
}
