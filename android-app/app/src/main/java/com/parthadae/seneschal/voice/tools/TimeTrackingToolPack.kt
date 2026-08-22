package com.parthadae.seneschal.voice.tools

import com.parthadae.seneschal.data.repository.ActivityRepository
import com.parthadae.seneschal.domain.Activity
import com.parthadae.seneschal.voice.VoiceCommandResult
import com.parthadae.seneschal.voice.commands.TimeTrackingVoiceActions
import java.time.Instant
import java.time.LocalDate
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The first client tool pack: thin schema'd wrappers over
 * [TimeTrackingVoiceActions], which stays the single implementation shared
 * with the offline regex handlers.
 */
@Singleton
class TimeTrackingToolPack @Inject constructor(
    private val actions: TimeTrackingVoiceActions,
    private val activityRepository: ActivityRepository,
) : VoiceToolPack {

    override val tools: List<VoiceTool> = listOf(
        tool(
            name = "start_timer",
            description = "Start the live timer tracking an activity from now, " +
                "stopping any currently running timer first.",
            parameters = objectSchema(
                required = listOf("activityId"),
                "activityId" to stringProp(ACTIVITY_ID_DESC),
            ),
            progressLabel = "Starting timer…",
        ) { args ->
            withActivity(args) { actions.startTimer(it) }
        },
        tool(
            name = "stop_timer",
            description = "Stop the currently running timer.",
            parameters = objectSchema(required = emptyList()),
            progressLabel = "Stopping timer…",
        ) { actions.stopTimer().toToolResult() },
        tool(
            name = "timer_status",
            description = "Report which activity the timer is currently tracking and for how long.",
            parameters = objectSchema(required = emptyList()),
            progressLabel = "Checking timer…",
        ) { actions.timerStatus().toToolResult() },
        tool(
            name = "log_time_range",
            description = "Assign an activity to a past time span, filling the " +
                "15-minute slots the span covers. Overwrites whatever was logged there.",
            parameters = objectSchema(
                required = listOf("activityId", "start", "end"),
                "activityId" to stringProp(ACTIVITY_ID_DESC),
                "start" to stringProp(TIMESTAMP_DESC),
                "end" to stringProp("$TIMESTAMP_DESC Must be after start."),
            ),
            progressLabel = "Logging time…",
        ) { args ->
            val range = rangeArgs(args) ?: return@tool badRange()
            withActivity(args) { actions.logRange(it, range.first, range.second) }
        },
        tool(
            name = "clear_time_range",
            description = "Erase all logged time in a past time span. Destructive — " +
                "only call when the user clearly asked to clear, erase, or delete logged time.",
            parameters = objectSchema(
                required = listOf("start", "end"),
                "start" to stringProp(TIMESTAMP_DESC),
                "end" to stringProp("$TIMESTAMP_DESC Must be after start."),
            ),
            requiresConfirmation = true,
            progressLabel = "Clearing time…",
        ) { args ->
            val range = rangeArgs(args) ?: return@tool badRange()
            actions.clearRange(range.first, range.second).toToolResult()
        },
        tool(
            name = "day_summary",
            description = "Summarize everything the user logged on a given day.",
            parameters = objectSchema(
                required = listOf("date"),
                "date" to stringProp("The day to summarize, as YYYY-MM-DD in the user's timezone."),
            ),
            progressLabel = "Summarizing…",
        ) { args ->
            val date = (args["date"] as? String)
                ?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
                ?: return@tool VoiceToolResult(
                    "Error: date must be YYYY-MM-DD.",
                    success = false,
                )
            actions.daySummary(date).toToolResult()
        },
    )

    private suspend fun withActivity(
        args: Map<String, Any?>,
        block: suspend (Activity) -> VoiceCommandResult,
    ): VoiceToolResult {
        val activity = (args["activityId"] as? String)
            ?.let { activityRepository.activityById(it) }
            ?: return VoiceToolResult(
                "Error: activityId does not match any of the user's activities. " +
                    "Use an id from the activity list exactly.",
                success = false,
            )
        return block(activity).toToolResult()
    }

    private fun rangeArgs(args: Map<String, Any?>): Pair<Long, Long>? {
        val start = parseInstant(args["start"] as? String) ?: return null
        val end = parseInstant(args["end"] as? String) ?: return null
        return if (start < end) start to end else null
    }

    private fun badRange() = VoiceToolResult(
        "Error: start and end must be ISO-8601 timestamps with start before end.",
        success = false,
    )

    private fun parseInstant(value: String?): Long? {
        if (value == null) return null
        return runCatching { Instant.parse(value).toEpochMilli() }.getOrNull()
            ?: runCatching {
                ZonedDateTime.parse(value, DateTimeFormatter.ISO_OFFSET_DATE_TIME)
                    .toInstant().toEpochMilli()
            }.getOrNull()
    }

    private companion object {
        const val ACTIVITY_ID_DESC =
            "Id of the activity, copied exactly from the activity list in the system prompt."
        const val TIMESTAMP_DESC = "ISO-8601 timestamp with UTC offset."
    }
}

private fun VoiceCommandResult.toToolResult(): VoiceToolResult = when (this) {
    is VoiceCommandResult.Success -> VoiceToolResult(speech, success = true)
    is VoiceCommandResult.Failure -> VoiceToolResult(speech, success = false)
}

private fun stringProp(description: String): Map<String, Any?> =
    mapOf("type" to "string", "description" to description)

private fun objectSchema(
    required: List<String>,
    vararg properties: Pair<String, Map<String, Any?>>,
): Map<String, Any?> = mapOf(
    "type" to "object",
    "properties" to properties.toMap(),
    "required" to required,
)

private fun tool(
    name: String,
    description: String,
    parameters: Map<String, Any?>,
    progressLabel: String,
    requiresConfirmation: Boolean = false,
    execute: suspend (Map<String, Any?>) -> VoiceToolResult,
): VoiceTool = object : VoiceTool {
    override val name = name
    override val description = description
    override val parameters = parameters
    override val requiresConfirmation = requiresConfirmation
    override val progressLabel = progressLabel
    override suspend fun execute(args: Map<String, Any?>) = execute(args)
}
