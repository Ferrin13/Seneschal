package com.parthadae.seneschal.data.remote.dto

import com.squareup.moshi.JsonClass

@JsonClass(generateAdapter = true)
data class MeDto(
    val id: String,
    val email: String?,
    val displayName: String?,
    val createdAt: String,
)

@JsonClass(generateAdapter = true)
data class CategoryDto(
    val id: String,
    val name: String,
    val kind: String,
    val color: String,
    val sortOrder: Int,
    val isActive: Boolean,
    val createdAt: String,
    val updatedAt: String,
    val clientUpdatedAt: String,
    val deletedAt: String?,
)

@JsonClass(generateAdapter = true)
data class ActivityDto(
    val id: String,
    val categoryId: String,
    val name: String,
    val sortOrder: Int,
    val isActive: Boolean,
    val archivedAt: String?,
    val createdAt: String,
    val updatedAt: String,
    val clientUpdatedAt: String,
    val deletedAt: String?,
)

@JsonClass(generateAdapter = true)
data class TimeSlotDto(
    val slotStartUtc: String,
    val primaryActivityId: String?,
    val secondaryActivityId: String?,
    val notes: String?,
    val updatedAt: String,
    val clientUpdatedAt: String,
    val deletedAt: String?,
)

@JsonClass(generateAdapter = true)
data class TimeSlotUpsertDto(
    val slotStartUtc: String,
    val primaryActivityId: String?,
    val secondaryActivityId: String?,
    val notes: String?,
    val clientUpdatedAt: String,
    val deleted: Boolean? = null,
)

@JsonClass(generateAdapter = true)
data class SlotsUpsertRequest(val slots: List<TimeSlotUpsertDto>)

@JsonClass(generateAdapter = true)
data class TimerDto(
    val primaryActivityId: String,
    val secondaryActivityId: String?,
    val notes: String?,
    val startedAt: String,
)

@JsonClass(generateAdapter = true)
data class TimerStartRequest(
    val primaryActivityId: String,
    val secondaryActivityId: String?,
    val notes: String?,
    val startedAt: String?,
)

@JsonClass(generateAdapter = true)
data class TimerStopRequest(val stoppedAt: String?)

@JsonClass(generateAdapter = true)
data class TimerStopResponse(
    val startedAt: String,
    val stoppedAt: String,
    val slots: List<TimeSlotDto>,
)

@JsonClass(generateAdapter = true)
data class CategoryCreateRequest(
    val name: String,
    val kind: String,
    val color: String,
    val sortOrder: Int = 0,
    val clientUpdatedAt: String? = null,
)

@JsonClass(generateAdapter = true)
data class CategoryPatchRequest(
    val name: String? = null,
    val kind: String? = null,
    val color: String? = null,
    val sortOrder: Int? = null,
    val isActive: Boolean? = null,
    val clientUpdatedAt: String? = null,
)

@JsonClass(generateAdapter = true)
data class ActivityCreateRequest(
    val categoryId: String,
    val name: String,
    val sortOrder: Int = 0,
    val clientUpdatedAt: String? = null,
)

@JsonClass(generateAdapter = true)
data class ActivityPatchRequest(
    val categoryId: String? = null,
    val name: String? = null,
    val sortOrder: Int? = null,
    val isActive: Boolean? = null,
    val archived: Boolean? = null,
    val clientUpdatedAt: String? = null,
)
