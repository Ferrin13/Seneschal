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

@JsonClass(generateAdapter = true)
data class BusinessDto(
    val id: String,
    val name: String,
    val sortOrder: Int,
    val isActive: Boolean,
    val createdAt: String,
    val updatedAt: String,
    val clientUpdatedAt: String,
    val deletedAt: String?,
)

@JsonClass(generateAdapter = true)
data class ExpenseDto(
    val id: String,
    val businessId: String?,
    val occurredAt: String?,
    val amountCents: Int?,
    val note: String?,
    val imageKey: String?,
    val createdAt: String,
    val updatedAt: String,
    val clientUpdatedAt: String,
    val deletedAt: String?,
)

@JsonClass(generateAdapter = true)
data class ExpenseUpsertDto(
    val id: String,
    val businessId: String?,
    val occurredAt: String?,
    val amountCents: Int?,
    val note: String?,
    val imageKey: String?,
    val clientUpdatedAt: String,
    val deleted: Boolean? = null,
)

@JsonClass(generateAdapter = true)
data class ExpensesUpsertRequest(val expenses: List<ExpenseUpsertDto>)

@JsonClass(generateAdapter = true)
data class MessageTemplateDto(
    val id: String,
    val title: String?,
    val body: String?,
    val createdAt: String,
    val updatedAt: String,
    val clientUpdatedAt: String,
    val deletedAt: String?,
)

@JsonClass(generateAdapter = true)
data class MessageTemplateUpsertDto(
    val id: String,
    val title: String?,
    val body: String?,
    val clientUpdatedAt: String,
    val deleted: Boolean? = null,
)

@JsonClass(generateAdapter = true)
data class MessageTemplatesUpsertRequest(val templates: List<MessageTemplateUpsertDto>)

@JsonClass(generateAdapter = true)
data class GroupDto(
    val id: String,
    val name: String?,
    val createdAt: String,
    val updatedAt: String,
    val clientUpdatedAt: String,
    val deletedAt: String?,
)

@JsonClass(generateAdapter = true)
data class GroupUpsertDto(
    val id: String,
    val name: String?,
    val clientUpdatedAt: String,
    val deleted: Boolean? = null,
)

@JsonClass(generateAdapter = true)
data class GroupsUpsertRequest(val groups: List<GroupUpsertDto>)

@JsonClass(generateAdapter = true)
data class GroupMemberDto(
    val id: String,
    val groupId: String?,
    val displayName: String?,
    val phoneNumber: String?,
    val contactLookupKey: String?,
    val createdAt: String,
    val updatedAt: String,
    val clientUpdatedAt: String,
    val deletedAt: String?,
)

@JsonClass(generateAdapter = true)
data class GroupMemberUpsertDto(
    val id: String,
    val groupId: String?,
    val displayName: String?,
    val phoneNumber: String?,
    val contactLookupKey: String?,
    val clientUpdatedAt: String,
    val deleted: Boolean? = null,
)

@JsonClass(generateAdapter = true)
data class GroupMembersUpsertRequest(val members: List<GroupMemberUpsertDto>)

@JsonClass(generateAdapter = true)
data class PresignedUploadRequest(
    val purpose: String,
    val contentType: String,
    val contentLength: Long,
)

@JsonClass(generateAdapter = true)
data class PresignedUploadResponse(
    val key: String,
    val url: String,
    val method: String,
    val headers: Map<String, String>,
    val expiresAt: String,
)

@JsonClass(generateAdapter = true)
data class PresignedDownloadResponse(
    val key: String,
    val url: String,
    val expiresAt: String,
)

/**
 * Internal payload schema for `image_upload` outbox rows. Not sent to the
 * server as-is — the upload handler reads this back out of the queue,
 * exchanges it for a presigned URL, PUTs the bytes, and dispatches the
 * resolved key to the matching `ImageAttacher`.
 */
@JsonClass(generateAdapter = true)
data class ImageUploadDto(
    val localPath: String,
    val contentType: String,
    val sizeBytes: Long,
    val ownerKind: String,
    val ownerId: String,
    val purpose: String,
)

@JsonClass(generateAdapter = true)
data class VoiceTimerContextDto(
    val activityId: String,
    val activityName: String,
    val startedAt: String,
)

@JsonClass(generateAdapter = true)
data class VoiceAudioDto(
    /** Raw base64 (no data-URI prefix). */
    val data: String,
    val format: String,
)

/** A client tool advertised to the server's LLM loop. */
@JsonClass(generateAdapter = true)
data class VoiceToolDefDto(
    val name: String,
    val description: String,
    /** JSON schema for the arguments object. */
    val parameters: Map<String, Any?>,
    val requiresConfirmation: Boolean = false,
)

/** A client tool invocation the LLM requested; the phone executes it. */
@JsonClass(generateAdapter = true)
data class VoiceToolCallDto(
    val id: String,
    val name: String,
    /** JSON-encoded arguments object. */
    val arguments: String,
)

@JsonClass(generateAdapter = true)
data class VoiceToolResultDto(
    val toolCallId: String,
    val result: String,
)

/**
 * POST /voice/command. A fresh turn sends [audio] or [transcript] plus the
 * client tool catalog; a continuation echoes back the [messages] array from
 * the previous response along with the [toolResults] of the client tool
 * calls it executed.
 */
@JsonClass(generateAdapter = true)
data class VoiceCommandRequest(
    val audio: VoiceAudioDto? = null,
    val transcript: String? = null,
    val toolCatalog: List<VoiceToolDefDto> = emptyList(),
    /** ISO-8601 with offset, e.g. 2026-08-17T17:03:00-06:00. */
    val now: String,
    /** IANA zone id, e.g. America/Denver. */
    val timezone: String,
    val runningTimer: VoiceTimerContextDto? = null,
    /** Opaque conversation state from the previous response. */
    val messages: List<Any?>? = null,
    val toolResults: List<VoiceToolResultDto>? = null,
)

/**
 * Either a final [speech] answer, or a batch of [toolCalls] to execute plus
 * the [messages] to echo back when continuing.
 */
@JsonClass(generateAdapter = true)
data class VoiceCommandResponse(
    /** What the server heard; present on the first response of a turn. */
    val transcript: String? = null,
    val speech: String? = null,
    val toolCalls: List<VoiceToolCallDto>? = null,
    val messages: List<Any?>? = null,
)
