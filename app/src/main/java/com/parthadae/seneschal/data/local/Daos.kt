package com.parthadae.seneschal.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface CategoryDao {
    @Query("SELECT * FROM categories WHERE deletedAt IS NULL ORDER BY sortOrder, name")
    fun observeActive(): Flow<List<CategoryEntity>>

    @Query("SELECT * FROM categories WHERE id = :id LIMIT 1")
    suspend fun byId(id: String): CategoryEntity?

    @Query("SELECT MAX(updatedAt) FROM categories")
    suspend fun maxUpdatedAt(): Long?

    @Upsert
    suspend fun upsertAll(rows: List<CategoryEntity>)

    @Query("DELETE FROM categories")
    suspend fun clear()
}

@Dao
interface ActivityDao {
    @Query("SELECT * FROM activities WHERE deletedAt IS NULL AND archivedAt IS NULL ORDER BY sortOrder, name")
    fun observeActive(): Flow<List<ActivityEntity>>

    @Query("SELECT * FROM activities WHERE deletedAt IS NULL ORDER BY sortOrder, name")
    fun observeAllIncludingArchived(): Flow<List<ActivityEntity>>

    @Query("SELECT * FROM activities WHERE id = :id LIMIT 1")
    suspend fun byId(id: String): ActivityEntity?

    @Query("SELECT MAX(updatedAt) FROM activities")
    suspend fun maxUpdatedAt(): Long?

    @Upsert
    suspend fun upsertAll(rows: List<ActivityEntity>)

    @Query("DELETE FROM activities")
    suspend fun clear()
}

@Dao
interface TimeSlotDao {
    @Query(
        "SELECT * FROM time_slots WHERE slotStartUtcMs >= :fromMs AND slotStartUtcMs < :toMs " +
            "AND deletedAt IS NULL ORDER BY slotStartUtcMs"
    )
    fun observeRange(fromMs: Long, toMs: Long): Flow<List<TimeSlotEntity>>

    @Query("SELECT * FROM time_slots WHERE slotStartUtcMs = :slotStartMs LIMIT 1")
    suspend fun byStart(slotStartMs: Long): TimeSlotEntity?

    @Query("SELECT MAX(updatedAt) FROM time_slots")
    suspend fun maxUpdatedAt(): Long?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(rows: List<TimeSlotEntity>)

    @Query("DELETE FROM time_slots WHERE slotStartUtcMs = :slotStartMs")
    suspend fun deleteByStart(slotStartMs: Long)

    @Query(
        "SELECT primaryActivityId AS activityId, MAX(updatedAt) AS lastUsedMs FROM time_slots " +
            "WHERE primaryActivityId IS NOT NULL AND deletedAt IS NULL " +
            "GROUP BY primaryActivityId ORDER BY lastUsedMs DESC LIMIT :limit"
    )
    fun observeRecentActivities(limit: Int): Flow<List<RecentActivity>>
}

data class RecentActivity(val activityId: String, val lastUsedMs: Long)

@Dao
interface RunningTimerDao {
    @Query("SELECT * FROM running_timer WHERE id = 1 LIMIT 1")
    fun observe(): Flow<RunningTimerEntity?>

    @Query("SELECT * FROM running_timer WHERE id = 1 LIMIT 1")
    suspend fun current(): RunningTimerEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: RunningTimerEntity)

    @Query("DELETE FROM running_timer")
    suspend fun clear()
}

@Dao
interface PendingMutationDao {
    @Query("SELECT * FROM pending_mutations ORDER BY id ASC LIMIT :limit")
    suspend fun take(limit: Int): List<PendingMutationEntity>

    @Insert
    suspend fun insert(row: PendingMutationEntity): Long

    @Query("DELETE FROM pending_mutations WHERE id = :id")
    suspend fun delete(id: Long)

    @Update
    suspend fun update(row: PendingMutationEntity)

    @Query("SELECT COUNT(*) FROM pending_mutations")
    fun observeCount(): Flow<Int>
}
