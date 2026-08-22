package com.parthadae.seneschal.ui.voice

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.parthadae.seneschal.voice.VoiceSessionController
import com.parthadae.seneschal.voice.VoiceSessionState
import kotlinx.coroutines.delay

/**
 * Bottom-anchored card shown while a voice session is active. Rendered above
 * the whole app from MainActivity so it appears regardless of the current
 * screen.
 */
@Composable
fun VoiceOverlay(
    controller: VoiceSessionController,
    modifier: Modifier = Modifier,
) {
    val state by controller.state.collectAsStateWithLifecycle()
    if (state is VoiceSessionState.Idle) return

    // Successful commands were already executed and confirmed aloud; let the
    // card clean itself up.
    LaunchedEffect(state) {
        val s = state
        if (s is VoiceSessionState.Responded && s.success) {
            delay(6_000)
            controller.dismiss()
        }
    }

    Box(modifier = modifier.fillMaxSize()) {
        Surface(
            shape = RoundedCornerShape(20.dp),
            tonalElevation = 6.dp,
            shadowElevation = 8.dp,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .navigationBarsPadding()
                .padding(16.dp)
                .fillMaxWidth(),
        ) {
            Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    StateIcon(state)
                    Spacer(Modifier.width(12.dp))
                    Text(
                        text = title(state),
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.weight(1f),
                    )
                    IconButton(onClick = controller::dismiss) {
                        Icon(Icons.Outlined.Close, contentDescription = "Dismiss voice session")
                    }
                }
                body(state)?.let { text ->
                    Spacer(Modifier.height(4.dp))
                    Text(
                        text = text,
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                caption(state)?.let { text ->
                    Spacer(Modifier.height(4.dp))
                    Text(
                        text = text,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (state is VoiceSessionState.Responded || state is VoiceSessionState.Failed) {
                    Spacer(Modifier.height(4.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.End,
                    ) {
                        TextButton(onClick = controller::listenAgain) { Text("Listen again") }
                    }
                }
            }
        }
    }
}

@Composable
private fun StateIcon(state: VoiceSessionState) {
    when (state) {
        is VoiceSessionState.Greeting, is VoiceSessionState.Listening -> {
            val pulse = rememberInfiniteTransition(label = "mic-pulse")
            val scale by pulse.animateFloat(
                initialValue = 1f,
                targetValue = 1.25f,
                animationSpec = infiniteRepeatable(
                    animation = tween(durationMillis = 600),
                    repeatMode = RepeatMode.Reverse,
                ),
                label = "mic-pulse-scale",
            )
            Icon(
                Icons.Outlined.Mic,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier
                    .size(28.dp)
                    .graphicsLayer {
                        scaleX = scale
                        scaleY = scale
                    },
            )
        }
        is VoiceSessionState.Executing -> CircularProgressIndicator(
            modifier = Modifier.size(24.dp),
            strokeWidth = 2.5.dp,
        )
        is VoiceSessionState.Responded -> Icon(
            if (state.success) Icons.Outlined.CheckCircle else Icons.Outlined.ErrorOutline,
            contentDescription = null,
            tint = if (state.success) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.error
            },
            modifier = Modifier.size(28.dp),
        )
        is VoiceSessionState.Failed -> Icon(
            Icons.Outlined.ErrorOutline,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.error,
            modifier = Modifier.size(28.dp),
        )
        VoiceSessionState.Idle -> Unit
    }
}

private fun title(state: VoiceSessionState): String = when (state) {
    is VoiceSessionState.Greeting -> "I'm listening"
    is VoiceSessionState.Listening -> "Listening…"
    is VoiceSessionState.Executing -> "Working on it…"
    is VoiceSessionState.Responded -> if (state.success) "Done" else "Hmm"
    is VoiceSessionState.Failed -> "Hmm"
    VoiceSessionState.Idle -> ""
}

private fun body(state: VoiceSessionState): String? = when (state) {
    is VoiceSessionState.Listening -> state.partialTranscript
    // Blank transcript = server path, where the transcript arrives with the
    // response rather than up front; show the tool progress label instead.
    is VoiceSessionState.Executing ->
        state.detail ?: state.transcript.takeIf { it.isNotBlank() }?.let { "\u201C$it\u201D" }
    is VoiceSessionState.Responded -> state.response
    is VoiceSessionState.Failed -> state.message
    else -> null
}

private fun caption(state: VoiceSessionState): String? = when (state) {
    is VoiceSessionState.Responded ->
        state.transcript.takeIf { it.isNotBlank() }?.let { "Heard: \u201C$it\u201D" }
    else -> null
}
