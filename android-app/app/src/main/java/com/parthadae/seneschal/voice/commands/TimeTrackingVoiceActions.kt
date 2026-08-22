package com.parthadae.seneschal.voice.commands

import com.parthadae.seneschal.data.repository.ActivityRepository
import com.parthadae.seneschal.data.repository.TimeSlotRepository
import com.parthadae.seneschal.data.repository.TimerRepository
import com.parthadae.seneschal.domain.Activity
import com.parthadae.seneschal.domain.SLOT_MS
import com.parthadae.seneschal.domain.slotsCoveredByMidpoint
import com.parthadae.seneschal.voice.VoiceCommandResult
import kotlinx.coroutines.flow.first
import java.time.LocalDate
import java.time.ZoneId
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The executable time-tracking actions behind voice commands, shared by the
 * local regex handlers and the LLM-interpreted intents from the backend.
 * Each action does the repository work and composes the spoken confirmation,
 * so both paths behave identically once an intent is resolved.
 */
@Singleton
class TimeTrackingVoiceActions @Inject constructor(
    private val timerRepository: TimerRepository,
    private val timeSlotRepository: TimeSlotRepository,
    private val activityRepository: ActivityRepository,
) {
    suspend fun startTimer(activity: Activity): VoiceCommandResult {
        val running = timerRepository.timer.first()
        if (running?.primaryActivityId == activity.id) {
            val elapsed = System.currentTimeMillis() - running.startedAtMs
            return VoiceCommandResult.Success(
                "Already tracking ${activity.name} — ${speakDuration(elapsed)} so far."
            )
        }
        val previousName = running?.let {
            activityRepository.activityById(it.primaryActivityId)?.name
        }
        if (running != null) timerRepository.stop()
        timerRepository.start(activity.id)
        return VoiceCommandResult.Success(
            if (previousName != null) {
                "Stopped $previousName and started tracking ${activity.name}."
            } else {
                "Started tracking ${activity.name}."
            }
        )
    }

    suspend fun stopTimer(): VoiceCommandResult {
        val running = timerRepository.timer.first()
            ?: return VoiceCommandResult.Failure("The timer isn't running.")
        val name = activityRepository.activityById(running.primaryActivityId)?.name
            ?: "your activity"
        val elapsed = System.currentTimeMillis() - running.startedAtMs
        timerRepository.stop()
        return VoiceCommandResult.Success(
            "Stopped tracking $name after ${speakDuration(elapsed)}."
        )
    }

    suspend fun timerStatus(): VoiceCommandResult {
        val running = timerRepository.timer.first()
            ?: return VoiceCommandResult.Success("The timer isn't running.")
        val name = activityRepository.activityById(running.primaryActivityId)?.name
            ?: "something"
        val elapsed = System.currentTimeMillis() - running.startedAtMs
        return VoiceCommandResult.Success(
            "You've been tracking $name for ${speakDuration(elapsed)}."
        )
    }

    /** Fill the slots midpoint-covered by [startMs, endMs) with [activity]. */
    suspend fun logRange(activity: Activity, startMs: Long, endMs: Long): VoiceCommandResult {
        val slots = slotsCoveredByMidpoint(startMs, endMs)
        if (slots.isEmpty()) {
            return VoiceCommandResult.Failure("That range is shorter than one 15 minute slot.")
        }
        timeSlotRepository.setRange(slots.first(), slots.last(), activity.id)
        return VoiceCommandResult.Success(
            "Logged ${activity.name} from ${speakClock(startMs)} to ${speakClock(endMs)}."
        )
    }

    suspend fun clearRange(startMs: Long, endMs: Long): VoiceCommandResult {
        val slots = slotsCoveredByMidpoint(startMs, endMs)
        if (slots.isEmpty()) {
            return VoiceCommandResult.Failure("That range is shorter than one 15 minute slot.")
        }
        timeSlotRepository.clearRange(slots.first(), slots.last())
        return VoiceCommandResult.Success(
            "Cleared ${speakClock(startMs)} to ${speakClock(endMs)}."
        )
    }

    /** Spoken summary of everything logged on [date]. */
    suspend fun daySummary(date: LocalDate): VoiceCommandResult {
        val zone = ZoneId.systemDefault()
        val today = LocalDate.now(zone)
        val dayWord = when (date) {
            today -> "today"
            today.minusDays(1) -> "yesterday"
            else -> "on $date"
        }
        val startMs = date.atStartOfDay(zone).toInstant().toEpochMilli()
        val endMs = date.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli() - 1

        val slots = timeSlotRepository.observeRange(startMs, endMs).first()
        val filled = slots.filter { !it.isDeleted && it.primaryActivityId != null }
        if (filled.isEmpty()) {
            return VoiceCommandResult.Success("You haven't logged anything $dayWord.")
        }

        val activitiesById = activityRepository.activitiesById.first()
        val byActivity = filled
            .groupBy { it.primaryActivityId!! }
            .map { (id, activitySlots) ->
                val name = activitiesById[id]?.name ?: "an unknown activity"
                name to activitySlots.size * SLOT_MS
            }
            .sortedByDescending { it.second }

        val totalMs = filled.size * SLOT_MS
        val top = byActivity.take(5).joinToString(", ") { (name, ms) ->
            "${speakDuration(ms)} of $name"
        }
        val more = if (byActivity.size > 5) ", and ${byActivity.size - 5} more" else ""
        var speech = "You logged ${speakDuration(totalMs)} $dayWord: $top$more."

        if (date == today) {
            timerRepository.timer.first()?.let { running ->
                activitiesById[running.primaryActivityId]?.let { activity ->
                    speech += " The timer is currently tracking ${activity.name}."
                }
            }
        }
        return VoiceCommandResult.Success(speech)
    }
}
