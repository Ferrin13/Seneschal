package com.parthadae.seneschal.data.repository

import com.parthadae.seneschal.data.local.BusinessDao
import com.parthadae.seneschal.domain.Business
import com.parthadae.seneschal.domain.toDomain
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Read-only view of the seeded business "enum". The list is populated by
 * the backend's `seedUserDefaults` and pulled by `BusinessPuller`.
 */
@Singleton
class BusinessRepository @Inject constructor(
    private val businessDao: BusinessDao,
) {
    val businesses: Flow<List<Business>> = businessDao.observeActive().map { list ->
        list.map { it.toDomain() }
    }

    val businessesById: Flow<Map<String, Business>> = businesses.map { list ->
        list.associateBy { it.id }
    }

    suspend fun byId(id: String): Business? =
        businessDao.byId(id)?.toDomain()
}
