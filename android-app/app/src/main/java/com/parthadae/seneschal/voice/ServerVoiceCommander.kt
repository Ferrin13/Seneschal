package com.parthadae.seneschal.voice

import android.util.Base64
import com.parthadae.seneschal.data.remote.SeneschalApi
import com.parthadae.seneschal.data.remote.dto.VoiceAudioDto
import com.parthadae.seneschal.data.remote.dto.VoiceCommandRequest
import com.parthadae.seneschal.data.remote.dto.VoiceTimerContextDto
import com.parthadae.seneschal.data.remote.dto.VoiceToolResultDto
import com.parthadae.seneschal.data.repository.ActivityRepository
import com.parthadae.seneschal.data.repository.TimerRepository
import com.parthadae.seneschal.voice.tools.VoiceToolRegistry
import com.parthadae.seneschal.voice.tools.VoiceToolResult
import com.squareup.moshi.Moshi
import com.squareup.moshi.Types
import kotlinx.coroutines.flow.first
import retrofit2.HttpException
import java.io.IOException
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Client side of the hybrid tool loop behind POST /voice/command.
 *
 * Sends the utterance (recorded audio on the primary path, a transcript on
 * the offline-recognizer fallback) together with the client tool catalog.
 * The server transcribes if needed, runs the LLM, and executes its own
 * server tools inline; whenever the LLM calls client tools, they come back
 * here, get executed through [VoiceToolRegistry] (the same repositories a
 * button tap uses), and the results are posted back to continue the
 * conversation — until the server returns final speech.
 */
@Singleton
class ServerVoiceCommander @Inject constructor(
    private val api: SeneschalApi,
    private val registry: VoiceToolRegistry,
    private val timerRepository: TimerRepository,
    private val activityRepository: ActivityRepository,
    moshi: Moshi,
) {
    sealed interface Input {
        data class Audio(val wavBytes: ByteArray) : Input
        data class Transcript(val text: String) : Input
    }

    data class Outcome(
        /** What the server heard; null when transcription never happened. */
        val transcript: String?,
        val result: VoiceCommandResult,
    )

    private val argsAdapter = moshi.adapter<Map<String, Any?>>(
        Types.newParameterizedType(Map::class.java, String::class.java, Any::class.java)
    )

    /** [onProgress] gets a short label while a tool executes ("Logging time…"). */
    suspend fun run(input: Input, onProgress: (String) -> Unit = {}): Outcome {
        val catalog = registry.catalog()
        var request = VoiceCommandRequest(
            audio = (input as? Input.Audio)?.let {
                VoiceAudioDto(
                    data = Base64.encodeToString(it.wavBytes, Base64.NO_WRAP),
                    format = "wav",
                )
            },
            transcript = (input as? Input.Transcript)?.text,
            toolCatalog = catalog,
            now = ZonedDateTime.now().format(DateTimeFormatter.ISO_OFFSET_DATE_TIME),
            timezone = ZoneId.systemDefault().id,
            runningTimer = runningTimerContext(),
        )

        var transcript: String? = null
        var anyToolSucceeded = false
        var anyToolFailed = false

        repeat(MAX_CLIENT_TURNS) {
            val response = try {
                api.voiceCommand(request)
            } catch (e: IOException) {
                return Outcome(
                    transcript,
                    VoiceCommandResult.Failure(
                        "I couldn't reach the server. Try again.",
                        transient = true,
                    ),
                )
            } catch (e: HttpException) {
                val message = if (e.code() == 503) {
                    "Voice recognition isn't set up on the server."
                } else {
                    "The server couldn't process that."
                }
                return Outcome(
                    transcript,
                    VoiceCommandResult.Failure(message, transient = true),
                )
            }
            if (transcript == null) {
                transcript = response.transcript?.takeIf { it.isNotBlank() }
            }

            response.speech?.let { speech ->
                // Failure when the tools that ran all failed, or nothing ran
                // because there was never a usable transcript.
                val failed = (anyToolFailed && !anyToolSucceeded) ||
                    (!anyToolSucceeded && !anyToolFailed && transcript == null)
                return Outcome(
                    transcript,
                    if (failed) {
                        VoiceCommandResult.Failure(speech)
                    } else {
                        VoiceCommandResult.Success(speech)
                    },
                )
            }

            val calls = response.toolCalls.orEmpty()
            if (calls.isEmpty()) {
                return Outcome(
                    transcript,
                    VoiceCommandResult.Failure(
                        "The server sent an unexpected response.",
                        transient = true,
                    ),
                )
            }

            val results = calls.map { call ->
                val toolResult = executeCall(call.name, call.arguments, onProgress)
                if (toolResult.success) anyToolSucceeded = true else anyToolFailed = true
                VoiceToolResultDto(toolCallId = call.id, result = toolResult.text)
            }

            request = VoiceCommandRequest(
                toolCatalog = catalog,
                now = ZonedDateTime.now().format(DateTimeFormatter.ISO_OFFSET_DATE_TIME),
                timezone = ZoneId.systemDefault().id,
                messages = response.messages,
                toolResults = results,
            )
        }

        return Outcome(
            transcript,
            VoiceCommandResult.Failure("That took too many steps. Try a simpler request."),
        )
    }

    private suspend fun executeCall(
        name: String,
        argumentsJson: String,
        onProgress: (String) -> Unit,
    ): VoiceToolResult {
        val tool = registry.byName(name)
            ?: return VoiceToolResult(
                "Error: this app version has no tool named \"$name\".",
                success = false,
            )
        onProgress(tool.progressLabel)
        val args = runCatching { argsAdapter.fromJson(argumentsJson) }.getOrNull()
            ?: emptyMap()
        return try {
            tool.execute(args)
        } catch (e: Exception) {
            VoiceToolResult(
                "Error: the tool failed (${e.message ?: e.javaClass.simpleName}).",
                success = false,
            )
        }
    }

    private suspend fun runningTimerContext(): VoiceTimerContextDto? {
        val timer = timerRepository.timer.first() ?: return null
        return VoiceTimerContextDto(
            activityId = timer.primaryActivityId,
            activityName = activityRepository.activityById(timer.primaryActivityId)?.name
                ?: "unknown",
            startedAt = Instant.ofEpochMilli(timer.startedAtMs).toString(),
        )
    }

    private companion object {
        /** Client-tool round trips per utterance before giving up. */
        const val MAX_CLIENT_TURNS = 4
    }
}
