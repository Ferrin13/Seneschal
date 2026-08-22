package com.parthadae.seneschal.voice

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.coroutineContext
import kotlin.math.max
import kotlin.math.sqrt

/**
 * Records one spoken utterance as 16 kHz mono 16-bit WAV with simple
 * energy-based endpointing: calibrate the noise floor briefly, wait for
 * speech, then stop after a trailing-silence window (or hard caps).
 *
 * Used by the server-transcription voice path; the RECORD_AUDIO permission
 * must already be granted (MainActivity ensures this before starting a
 * session).
 */
@Singleton
class VoiceAudioRecorder @Inject constructor() {
    sealed interface Result {
        /** Complete WAV file bytes (header + PCM). */
        data class Recorded(val wavBytes: ByteArray) : Result
        data object NoSpeech : Result
        data class Error(val message: String) : Result
    }

    @SuppressLint("MissingPermission")
    suspend fun recordUtterance(): Result = withContext(Dispatchers.IO) {
        val minBuffer = AudioRecord.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
        )
        if (minBuffer <= 0) return@withContext Result.Error("Microphone unavailable")
        val record = try {
            AudioRecord(
                MediaRecorder.AudioSource.VOICE_RECOGNITION,
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                max(minBuffer, FRAME_SAMPLES * 8 * 2),
            )
        } catch (e: Exception) {
            return@withContext Result.Error("Microphone unavailable")
        }
        if (record.state != AudioRecord.STATE_INITIALIZED) {
            record.release()
            return@withContext Result.Error("Microphone unavailable")
        }

        val pcm = ByteArrayOutputStream()
        val frame = ShortArray(FRAME_SAMPLES)
        var elapsedMs = 0L
        var calibrationFrames = 0
        var noiseFloor = 0.0
        var speechStarted = false
        var trailingSilenceMs = 0L

        try {
            record.startRecording()
            while (true) {
                coroutineContext.ensureActive()
                val read = record.read(frame, 0, frame.size)
                if (read <= 0) return@withContext Result.Error("Microphone read failed")
                writeFrame(pcm, frame, read)
                elapsedMs += read * 1000L / SAMPLE_RATE

                val rms = rms(frame, read)
                if (calibrationFrames < CALIBRATION_FRAMES) {
                    // Rolling average of ambient level before any speech.
                    noiseFloor = (noiseFloor * calibrationFrames + rms) / (calibrationFrames + 1)
                    calibrationFrames++
                    continue
                }
                val speechThreshold = max(noiseFloor * 3.0, MIN_SPEECH_RMS)
                val silenceThreshold = max(noiseFloor * 2.0, MIN_SILENCE_RMS)

                if (!speechStarted) {
                    if (rms >= speechThreshold) speechStarted = true
                    if (!speechStarted && elapsedMs >= NO_SPEECH_TIMEOUT_MS) {
                        return@withContext Result.NoSpeech
                    }
                } else {
                    trailingSilenceMs = if (rms < silenceThreshold) {
                        trailingSilenceMs + FRAME_MS
                    } else {
                        0
                    }
                    if (trailingSilenceMs >= END_SILENCE_MS) break
                }
                if (elapsedMs >= MAX_DURATION_MS) {
                    if (!speechStarted) return@withContext Result.NoSpeech
                    break
                }
            }
        } finally {
            runCatching { record.stop() }
            record.release()
        }
        Result.Recorded(wrapAsWav(pcm.toByteArray()))
    }

    private fun writeFrame(out: ByteArrayOutputStream, frame: ShortArray, count: Int) {
        for (i in 0 until count) {
            val s = frame[i].toInt()
            out.write(s and 0xFF)
            out.write((s shr 8) and 0xFF)
        }
    }

    private fun rms(frame: ShortArray, count: Int): Double {
        var sum = 0.0
        for (i in 0 until count) {
            val v = frame[i].toDouble()
            sum += v * v
        }
        return sqrt(sum / count)
    }

    /** Standard 44-byte RIFF/WAVE header for 16 kHz mono PCM16. */
    private fun wrapAsWav(pcm: ByteArray): ByteArray {
        val byteRate = SAMPLE_RATE * 2
        val out = ByteArrayOutputStream(pcm.size + 44)
        fun str(s: String) = out.write(s.toByteArray(Charsets.US_ASCII))
        fun int32(v: Int) {
            out.write(v and 0xFF)
            out.write((v shr 8) and 0xFF)
            out.write((v shr 16) and 0xFF)
            out.write((v shr 24) and 0xFF)
        }
        fun int16(v: Int) {
            out.write(v and 0xFF)
            out.write((v shr 8) and 0xFF)
        }
        str("RIFF"); int32(36 + pcm.size); str("WAVE")
        str("fmt "); int32(16); int16(1); int16(1)
        int32(SAMPLE_RATE); int32(byteRate); int16(2); int16(16)
        str("data"); int32(pcm.size)
        out.write(pcm)
        return out.toByteArray()
    }

    private companion object {
        const val SAMPLE_RATE = 16_000
        const val FRAME_MS = 20
        const val FRAME_SAMPLES = SAMPLE_RATE * FRAME_MS / 1000
        const val CALIBRATION_FRAMES = 15 // ~300 ms of ambient noise sampling

        /** Floors so a dead-quiet room doesn't produce hair-trigger thresholds. */
        const val MIN_SPEECH_RMS = 300.0
        const val MIN_SILENCE_RMS = 200.0

        const val END_SILENCE_MS = 1_400L
        const val NO_SPEECH_TIMEOUT_MS = 6_000L
        const val MAX_DURATION_MS = 12_000L
    }
}
