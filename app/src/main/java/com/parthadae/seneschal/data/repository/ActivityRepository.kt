package com.parthadae.seneschal.data.repository

import com.parthadae.seneschal.data.local.ActivityDao
import com.parthadae.seneschal.data.local.ActivityEntity
import com.parthadae.seneschal.data.local.CategoryDao
import com.parthadae.seneschal.data.local.CategoryEntity
import com.parthadae.seneschal.data.local.TimeSlotDao
import com.parthadae.seneschal.data.remote.SeneschalApi
import com.parthadae.seneschal.data.remote.dto.ActivityCreateRequest
import com.parthadae.seneschal.data.remote.dto.ActivityDto
import com.parthadae.seneschal.data.remote.dto.ActivityPatchRequest
import com.parthadae.seneschal.data.remote.dto.CategoryCreateRequest
import com.parthadae.seneschal.data.remote.dto.CategoryDto
import com.parthadae.seneschal.data.remote.dto.CategoryPatchRequest
import com.parthadae.seneschal.domain.Activity
import com.parthadae.seneschal.domain.Category
import com.parthadae.seneschal.domain.toDomain
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ActivityRepository @Inject constructor(
    private val categoryDao: CategoryDao,
    private val activityDao: ActivityDao,
    private val timeSlotDao: TimeSlotDao,
    private val api: SeneschalApi,
) {
    val categories: Flow<List<Category>> = categoryDao.observeActive().map { list ->
        list.map { it.toDomain() }
    }

    val activities: Flow<List<Activity>> = activityDao.observeActive().map { list ->
        list.map { it.toDomain() }
    }

    val activitiesById: Flow<Map<String, Activity>> = activities.map { list ->
        list.associateBy { it.id }
    }

    val categoriesById: Flow<Map<String, Category>> = categories.map { list ->
        list.associateBy { it.id }
    }

    /**
     * Top N activities most recently used, in last-used-first order. The
     * Today screen shows these as one-tap chips.
     */
    fun recentActivities(limit: Int = 8): Flow<List<Activity>> =
        combine(timeSlotDao.observeRecentActivities(limit), activitiesById) { recents, byId ->
            recents.mapNotNull { byId[it.activityId] }
        }

    suspend fun activityById(id: String): Activity? =
        activityDao.byId(id)?.toDomain()

    // ---- mutations (online for v1; sync worker pulls them back into Room) ----

    suspend fun createActivity(categoryId: String, name: String, sortOrder: Int = 0) {
        val dto = api.createActivity(
            ActivityCreateRequest(
                categoryId = categoryId,
                name = name,
                sortOrder = sortOrder,
                clientUpdatedAt = Instant.now().toString(),
            )
        )
        activityDao.upsertAll(listOf(dto.toEntity()))
    }

    suspend fun renameActivity(id: String, name: String) {
        val dto = api.patchActivity(
            id,
            ActivityPatchRequest(name = name, clientUpdatedAt = Instant.now().toString()),
        )
        activityDao.upsertAll(listOf(dto.toEntity()))
    }

    suspend fun setActivityArchived(id: String, archived: Boolean) {
        val dto = api.patchActivity(
            id,
            ActivityPatchRequest(
                archived = archived,
                clientUpdatedAt = Instant.now().toString(),
            ),
        )
        activityDao.upsertAll(listOf(dto.toEntity()))
    }

    suspend fun setActivityOrder(id: String, sortOrder: Int) {
        val dto = api.patchActivity(
            id,
            ActivityPatchRequest(
                sortOrder = sortOrder,
                clientUpdatedAt = Instant.now().toString(),
            ),
        )
        activityDao.upsertAll(listOf(dto.toEntity()))
    }

    suspend fun moveActivity(id: String, newCategoryId: String) {
        val dto = api.patchActivity(
            id,
            ActivityPatchRequest(
                categoryId = newCategoryId,
                clientUpdatedAt = Instant.now().toString(),
            ),
        )
        activityDao.upsertAll(listOf(dto.toEntity()))
    }

    suspend fun createCategory(name: String, kind: String, color: String, sortOrder: Int = 0) {
        val dto = api.createCategory(
            CategoryCreateRequest(
                name = name,
                kind = kind,
                color = color,
                sortOrder = sortOrder,
                clientUpdatedAt = Instant.now().toString(),
            )
        )
        categoryDao.upsertAll(listOf(dto.toEntity()))
    }

    suspend fun renameCategory(id: String, name: String) {
        val dto = api.patchCategory(
            id,
            CategoryPatchRequest(name = name, clientUpdatedAt = Instant.now().toString()),
        )
        categoryDao.upsertAll(listOf(dto.toEntity()))
    }

    suspend fun setCategoryColor(id: String, color: String) {
        val dto = api.patchCategory(
            id,
            CategoryPatchRequest(color = color, clientUpdatedAt = Instant.now().toString()),
        )
        categoryDao.upsertAll(listOf(dto.toEntity()))
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
