package com.parthadae.seneschal.sync

import com.parthadae.seneschal.data.local.GroupMemberDao
import com.parthadae.seneschal.data.local.GroupMemberEntity
import com.parthadae.seneschal.data.remote.SeneschalApi
import com.parthadae.seneschal.data.remote.dto.GroupMemberDto
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Incremental pull of group members across all of the user's groups.
 */
@Singleton
class GroupMemberPuller @Inject constructor(
    private val api: SeneschalApi,
    private val groupMemberDao: GroupMemberDao,
) : Puller {
    // Group members FK into groups, so run after GroupPuller.
    override val order: Int = Puller.ORDER_DEPENDENT

    override suspend fun pull() {
        val since = groupMemberDao.maxUpdatedAt()
            ?.let { Instant.ofEpochMilli(it).toString() }
        val rows = api.getGroupMembers(since = since)
        if (rows.isNotEmpty()) {
            groupMemberDao.upsertAll(rows.mapNotNull { it.toEntity() })
        }
    }

    private fun GroupMemberDto.toEntity(): GroupMemberEntity? {
        if (deletedAt == null) {
            if (groupId == null || displayName == null || phoneNumber == null) return null
        }
        return GroupMemberEntity(
            id = id,
            groupId = groupId.orEmpty(),
            displayName = displayName.orEmpty(),
            phoneNumber = phoneNumber.orEmpty(),
            contactLookupKey = contactLookupKey,
            createdAt = Instant.parse(createdAt).toEpochMilli(),
            updatedAt = Instant.parse(updatedAt).toEpochMilli(),
            clientUpdatedAt = Instant.parse(clientUpdatedAt).toEpochMilli(),
            deletedAt = deletedAt?.let { Instant.parse(it).toEpochMilli() },
        )
    }
}
