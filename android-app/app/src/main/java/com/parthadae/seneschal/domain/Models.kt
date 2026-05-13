package com.parthadae.seneschal.domain

import androidx.compose.ui.graphics.Color
import com.parthadae.seneschal.data.local.ActivityEntity
import com.parthadae.seneschal.data.local.CategoryEntity
import com.parthadae.seneschal.data.local.TimeSlotEntity

data class Category(
    val id: String,
    val name: String,
    val kind: String,
    val color: Color,
    val sortOrder: Int,
    val isActive: Boolean,
)

data class Activity(
    val id: String,
    val categoryId: String,
    val name: String,
    val sortOrder: Int,
    val isActive: Boolean,
    val isArchived: Boolean,
)

data class TimeSlot(
    val slotStartUtcMs: Long,
    val primaryActivityId: String?,
    val secondaryActivityId: String?,
    val notes: String?,
    val updatedAtMs: Long,
    val clientUpdatedAtMs: Long,
    val isDeleted: Boolean,
)

data class RunningTimer(
    val primaryActivityId: String,
    val secondaryActivityId: String?,
    val notes: String?,
    val startedAtMs: Long,
)

fun CategoryEntity.toDomain() = Category(
    id = id,
    name = name,
    kind = kind,
    color = parseHexColor(color),
    sortOrder = sortOrder,
    isActive = isActive,
)

fun ActivityEntity.toDomain() = Activity(
    id = id,
    categoryId = categoryId,
    name = name,
    sortOrder = sortOrder,
    isActive = isActive,
    isArchived = archivedAt != null,
)

fun TimeSlotEntity.toDomain() = TimeSlot(
    slotStartUtcMs = slotStartUtcMs,
    primaryActivityId = primaryActivityId,
    secondaryActivityId = secondaryActivityId,
    notes = notes,
    updatedAtMs = updatedAt,
    clientUpdatedAtMs = clientUpdatedAt,
    isDeleted = deletedAt != null,
)

private fun parseHexColor(hex: String): Color {
    val cleaned = hex.removePrefix("#")
    val v = cleaned.toLong(16)
    return when (cleaned.length) {
        6 -> Color(0xFF000000 or v)
        8 -> Color(v)
        else -> Color.Gray
    }
}
