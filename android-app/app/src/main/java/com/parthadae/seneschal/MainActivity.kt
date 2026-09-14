package com.parthadae.seneschal

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.parthadae.seneschal.auth.AuthRepository
import com.parthadae.seneschal.auth.AuthState
import com.parthadae.seneschal.ui.SeneschalRoot
import com.parthadae.seneschal.ui.theme.SeneschalTheme
import com.parthadae.seneschal.ui.voice.VoiceOverlay
import com.parthadae.seneschal.voice.VoiceSessionController
import com.parthadae.seneschal.voice.VoiceSettingsRepository
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    @Inject lateinit var voiceSession: VoiceSessionController
    @Inject lateinit var voiceSettings: VoiceSettingsRepository
    @Inject lateinit var authRepository: AuthRepository

    private val micPermissionRequest =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) voiceSession.start()
        }

    // Result is irrelevant: DealAlertNotifier re-checks the OS setting each
    // time it goes to post, and Settings offers a shortcut to re-enable.
    private val notificationPermissionRequest =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // savedInstanceState == null distinguishes a real launch from a
        // configuration-change or process-death recreation.
        if (savedInstanceState == null && isExternalLaunch(intent)) {
            maybeStartVoiceSession()
        }
        if (savedInstanceState == null) {
            requestNotificationPermissionOnceSignedIn()
        }
        setContent {
            SeneschalTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    Box(modifier = Modifier.fillMaxSize()) {
                        SeneschalRoot()
                        VoiceOverlay(controller = voiceSession)
                    }
                }
            }
        }
    }

    // With launchMode="singleTask", reopening the app while it's already in
    // the background (side-key remap, "Hey Google, open Seneschal", launcher
    // icon) lands here instead of onCreate.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (isExternalLaunch(intent)) {
            maybeStartVoiceSession()
        }
    }

    /**
     * Both the Samsung side-key "open app" remap and Assistant/Gemini's
     * "open Seneschal" fire the plain launcher intent, so that's the trigger
     * for a voice session.
     */
    private fun isExternalLaunch(intent: Intent?): Boolean =
        intent?.action == Intent.ACTION_MAIN && intent.hasCategory(Intent.CATEGORY_LAUNCHER)

    /**
     * Deal-hunter alerts arrive as push notifications, which on Android 13+
     * need the runtime POST_NOTIFICATIONS permission. Ask once the user is
     * signed in (the sign-in screen isn't the moment for it); the system
     * handles "asked already" so this is harmless on later launches.
     */
    private fun requestNotificationPermissionOnceSignedIn() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        lifecycleScope.launch {
            authRepository.authState.filterIsInstance<AuthState.SignedIn>().first()
            val granted = ContextCompat.checkSelfPermission(
                this@MainActivity,
                Manifest.permission.POST_NOTIFICATIONS,
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) {
                notificationPermissionRequest.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }

    private fun maybeStartVoiceSession() {
        lifecycleScope.launch {
            if (!voiceSettings.listenOnLaunch.first()) return@launch
            val granted = ContextCompat.checkSelfPermission(
                this@MainActivity,
                Manifest.permission.RECORD_AUDIO,
            ) == PackageManager.PERMISSION_GRANTED
            if (granted) {
                voiceSession.start()
            } else {
                micPermissionRequest.launch(Manifest.permission.RECORD_AUDIO)
            }
        }
    }
}
