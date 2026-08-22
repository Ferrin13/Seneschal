package com.parthadae.seneschal.voice

import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import com.parthadae.seneschal.data.repository.ActivityRepository
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.util.Locale
import javax.inject.Inject
import javax.inject.Singleton

sealed interface VoiceSessionState {
    data object Idle : VoiceSessionState

    /** TTS is speaking the "I'm listening" prompt. */
    data object Greeting : VoiceSessionState

    /** Audio is being captured (partials only exist on the offline path). */
    data class Listening(val partialTranscript: String?) : VoiceSessionState

    /**
     * The command is running. [transcript] is blank on the server path until
     * the response arrives; [detail] is a short progress label while a tool
     * executes ("Logging time…").
     */
    data class Executing(
        val transcript: String,
        val detail: String? = null,
    ) : VoiceSessionState

    /** A command handler finished; [response] is spoken and displayed. */
    data class Responded(
        val transcript: String,
        val response: String,
        val success: Boolean,
    ) : VoiceSessionState

    /** Speech capture itself failed (recognizer error, no mic, etc). */
    data class Failed(val message: String) : VoiceSessionState
}

/**
 * Runs a "voice session": speak "I'm listening" via TTS, capture one
 * utterance, run the command, then speak the response.
 *
 * Two capture paths:
 * - Online (primary): record raw audio with [VoiceAudioRecorder] and send it
 *   to the backend via [ServerVoiceCommander], where Whisper-class STT
 *   transcribes it and the LLM interprets it in one round trip. Much more
 *   accurate than the on-device recognizer.
 * - Offline (fallback): the on-device [SpeechRecognizer] (biased toward the
 *   user's activity names), routed through [VoiceCommandDispatcher] so the
 *   local regex handlers still work without a network.
 *
 * Triggered by [com.parthadae.seneschal.MainActivity] when the app is opened
 * from outside (side-key remap, "Hey Google, open Seneschal", launcher icon).
 * The caller is responsible for RECORD_AUDIO permission before calling [start].
 *
 * All TTS/recognizer work is marshalled onto the main thread, as required by
 * SpeechRecognizer.
 */
@Singleton
class VoiceSessionController @Inject constructor(
    @ApplicationContext private val context: Context,
    private val dispatcher: VoiceCommandDispatcher,
    private val audioRecorder: VoiceAudioRecorder,
    private val serverCommander: ServerVoiceCommander,
    private val activityRepository: ActivityRepository,
) {
    private val _state = MutableStateFlow<VoiceSessionState>(VoiceSessionState.Idle)
    val state: StateFlow<VoiceSessionState> = _state.asStateFlow()

    private val mainHandler = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var greetWhenTtsReady = false
    private var recognizer: SpeechRecognizer? = null
    private var captureJob: Job? = null

    /** Speak the greeting, then hand off to speech recognition. */
    fun start() {
        mainHandler.post {
            // Already mid-session (e.g. relaunched while listening): leave it be.
            val s = _state.value
            if (s is VoiceSessionState.Greeting ||
                s is VoiceSessionState.Listening ||
                s is VoiceSessionState.Executing
            ) {
                return@post
            }
            stopCapture()
            _state.value = VoiceSessionState.Greeting
            if (ttsReady) speakGreeting() else initTtsThenGreet()
        }
    }

    /** Skip the spoken greeting and go straight to listening (retry path). */
    fun listenAgain() {
        mainHandler.post {
            tts?.stop()
            stopCapture()
            startListening()
        }
    }

    fun dismiss() {
        mainHandler.post {
            tts?.stop()
            stopCapture()
            _state.value = VoiceSessionState.Idle
        }
    }

    private fun initTtsThenGreet() {
        greetWhenTtsReady = true
        if (tts != null) return // init already in flight
        tts = TextToSpeech(context) { status ->
            mainHandler.post {
                ttsReady = status == TextToSpeech.SUCCESS
                if (ttsReady) {
                    tts?.language = Locale.getDefault()
                    tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                        override fun onStart(utteranceId: String?) {}

                        override fun onDone(utteranceId: String?) {
                            // Called on a TTS engine thread. Only the greeting
                            // hands off to the recognizer; command responses
                            // just finish speaking.
                            if (utteranceId != GREETING_UTTERANCE) return
                            mainHandler.post {
                                if (_state.value is VoiceSessionState.Greeting) startListening()
                            }
                        }

                        @Deprecated("Deprecated in Java")
                        override fun onError(utteranceId: String?) {
                            if (utteranceId != GREETING_UTTERANCE) return
                            mainHandler.post {
                                if (_state.value is VoiceSessionState.Greeting) startListening()
                            }
                        }
                    })
                }
                if (greetWhenTtsReady) {
                    greetWhenTtsReady = false
                    if (ttsReady) speakGreeting() else startListening()
                }
            }
        }
    }

    private fun speakGreeting() {
        val result = tts?.speak("I'm listening", TextToSpeech.QUEUE_FLUSH, null, GREETING_UTTERANCE)
        if (result != TextToSpeech.SUCCESS) startListening()
    }

    private fun speakResponse(text: String) {
        if (ttsReady) {
            tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, RESPONSE_UTTERANCE)
        }
    }

    private fun startListening() {
        if (isOnline()) startServerCapture() else startOnDeviceRecognition()
    }

    /**
     * Primary path: record the utterance ourselves and let the backend
     * transcribe + interpret it in one call.
     */
    private fun startServerCapture() {
        _state.value = VoiceSessionState.Listening(partialTranscript = null)
        captureJob = scope.launch {
            val recorded = when (val r = audioRecorder.recordUtterance()) {
                is VoiceAudioRecorder.Result.NoSpeech -> {
                    if (_state.value is VoiceSessionState.Listening) {
                        _state.value = VoiceSessionState.Failed("Didn't catch that")
                    }
                    return@launch
                }
                is VoiceAudioRecorder.Result.Error -> {
                    // Mic trouble on the audio path; the recognizer manages the
                    // mic itself, so it may still work.
                    if (_state.value is VoiceSessionState.Listening) startOnDeviceRecognition()
                    return@launch
                }
                is VoiceAudioRecorder.Result.Recorded -> r.wavBytes
            }
            if (_state.value !is VoiceSessionState.Listening) return@launch

            // No transcript yet — the server produces it.
            _state.value = VoiceSessionState.Executing(transcript = "")
            val outcome = serverCommander.run(
                ServerVoiceCommander.Input.Audio(recorded)
            ) { label ->
                if (_state.value is VoiceSessionState.Executing) {
                    _state.value = VoiceSessionState.Executing(transcript = "", detail = label)
                }
            }
            if (_state.value !is VoiceSessionState.Executing) return@launch
            val (speech, success) = when (val res = outcome.result) {
                is VoiceCommandResult.Success -> res.speech to true
                is VoiceCommandResult.Failure -> res.speech to false
            }
            if (outcome.transcript == null && !success) {
                // Never even got a transcript (network, server config) — treat
                // like a capture failure so "Listen again" is the obvious next step.
                _state.value = VoiceSessionState.Failed(speech)
            } else {
                _state.value = VoiceSessionState.Responded(
                    transcript = outcome.transcript.orEmpty(),
                    response = speech,
                    success = success,
                )
                speakResponse(speech)
            }
        }
    }

    /** Offline fallback: on-device SpeechRecognizer + local regex handlers. */
    private fun startOnDeviceRecognition() {
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            _state.value = VoiceSessionState.Failed("Speech recognition is not available on this device")
            return
        }
        _state.value = VoiceSessionState.Listening(partialTranscript = null)
        scope.launch {
            val biasing = activityNamesForBiasing()
            if (_state.value is VoiceSessionState.Listening) startRecognizer(biasing)
        }
    }

    private fun startRecognizer(biasingStrings: List<String>) {
        val recognizer = SpeechRecognizer.createSpeechRecognizer(context)
        this.recognizer = recognizer
        recognizer.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(eventType: Int, params: Bundle?) {}

            override fun onPartialResults(partialResults: Bundle?) {
                val text = partialResults
                    ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    ?.firstOrNull()
                if (!text.isNullOrBlank()) {
                    _state.value = VoiceSessionState.Listening(partialTranscript = text)
                }
            }

            override fun onResults(results: Bundle?) {
                val text = results
                    ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    ?.firstOrNull()
                if (text.isNullOrBlank()) {
                    _state.value = VoiceSessionState.Failed("Didn't catch that")
                } else {
                    executeCommand(text)
                }
                destroyRecognizer()
            }

            override fun onError(error: Int) {
                _state.value = VoiceSessionState.Failed(errorMessage(error))
                destroyRecognizer()
            }
        })
        recognizer.startListening(
            Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(
                    RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                    RecognizerIntent.LANGUAGE_MODEL_FREE_FORM,
                )
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
                if (Build.VERSION.SDK_INT >= 33 && biasingStrings.isNotEmpty()) {
                    // Nudge recognition toward the vocabulary commands actually
                    // use — especially unusual activity names.
                    putStringArrayListExtra(
                        RecognizerIntent.EXTRA_BIASING_STRINGS,
                        ArrayList(biasingStrings),
                    )
                }
            }
        )
    }

    private suspend fun activityNamesForBiasing(): List<String> {
        if (Build.VERSION.SDK_INT < 33) return emptyList()
        val names = runCatching { activityRepository.activities.first().map { it.name } }
            .getOrDefault(emptyList())
        return names + listOf("start tracking", "stop the timer", "log", "clear", "what did I do")
    }

    private fun isOnline(): Boolean {
        val cm = context.getSystemService(ConnectivityManager::class.java) ?: return false
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }

    private fun executeCommand(transcript: String) {
        _state.value = VoiceSessionState.Executing(transcript)
        scope.launch {
            val result = dispatcher.dispatch(transcript)
            val (speech, success) = when (result) {
                is VoiceCommandResult.Success -> result.speech to true
                is VoiceCommandResult.Failure -> result.speech to false
            }
            // A dismiss may have raced the dispatch; don't resurrect the overlay.
            if (_state.value !is VoiceSessionState.Executing) return@launch
            _state.value = VoiceSessionState.Responded(transcript, speech, success)
            speakResponse(speech)
        }
    }

    private fun destroyRecognizer() {
        recognizer?.destroy()
        recognizer = null
    }

    /** Stop whichever capture path is active (recorder job or recognizer). */
    private fun stopCapture() {
        captureJob?.cancel()
        captureJob = null
        destroyRecognizer()
    }

    private fun errorMessage(code: Int): String = when (code) {
        SpeechRecognizer.ERROR_NO_MATCH,
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT,
        -> "Didn't catch that"
        SpeechRecognizer.ERROR_AUDIO -> "Microphone error"
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission is required"
        SpeechRecognizer.ERROR_NETWORK,
        SpeechRecognizer.ERROR_NETWORK_TIMEOUT,
        -> "Network error during speech recognition"
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Speech recognizer is busy, try again"
        else -> "Speech recognition failed (code $code)"
    }

    private companion object {
        const val GREETING_UTTERANCE = "greeting"
        const val RESPONSE_UTTERANCE = "response"
    }
}
