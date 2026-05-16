package com.parthadae.seneschal.sync

import com.parthadae.seneschal.data.local.ActivityDao
import com.parthadae.seneschal.data.local.ActivityEntity
import com.parthadae.seneschal.data.local.CategoryDao
import com.parthadae.seneschal.data.local.CategoryEntity
import com.parthadae.seneschal.data.remote.SeneschalApi
import com.parthadae.seneschal.data.remote.dto.ActivityDto
import com.parthadae.seneschal.data.remote.dto.CategoryDto
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Pulls the full category and activity lists every sync. Incremental pulls
 * by `since` would miss hard-deletes / manual server-side re-ids, and the
 * dataset is tiny per user — over-fetching is negligible.
 *
 * Order matters: activities have a FK to categories (NO_ACTION on delete),
 * so we prune activities first when reconciling.
 */
@Singleton
class CategoryActivityPuller @Inject constructor(
    private val api: SeneschalApi,
    private val categoryDao: CategoryDao,
    private val activityDao: ActivityDao,
) : Puller {
    override suspend fun pull() {
        val cats = api.getCategories(since = null, includeDeleted = true)
        val acts = api.getActivities(since = null, includeDeleted = true)

        if (cats.isNotEmpty()) categoryDao.upsertAll(cats.map { it.toEntity() })
        if (acts.isNotEmpty()) activityDao.upsertAll(acts.map { it.toEntity() })

        activityDao.deleteWhereIdNotIn(acts.map { it.id })
        categoryDao.deleteWhereIdNotIn(cats.map { it.id })
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
}
