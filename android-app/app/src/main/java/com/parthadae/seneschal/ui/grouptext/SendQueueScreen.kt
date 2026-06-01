package com.parthadae.seneschal.ui.grouptext

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle

/**
 * Drains the queued [PendingSend] one recipient at a time. Each tap on
 * "Send" launches `ACTION_SENDTO` with `smsto:<number>` plus the body as
 * `sms_body`, opening the user's default Messages app pre-filled. The
 * user taps Send inside Messages, then returns; we increment the cursor
 * and offer the next recipient. Skip increments without launching.
 *
 * Android does not signal whether the user actually sent the message vs
 * cancelled inside the Messages app, so "returned" is treated as
 * "handled" — that's the deliberate trade-off documented in the plan.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SendQueueScreen(
    onDone: () -> Unit,
    vm: SendQueueViewModel = hiltViewModel(),
) {
    val state by vm.state.collectAsStateWithLifecycle()

    val launcher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult(),
    ) {
        vm.onSent()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = onDone) {
                        Icon(
                            Icons.AutoMirrored.Outlined.ArrowBack,
                            contentDescription = "Back",
                        )
                    }
                },
                title = { Text("Sending") },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (state.error != null) {
                Text(
                    state.error!!,
                    color = MaterialTheme.colorScheme.error,
                )
                Button(onClick = onDone, modifier = Modifier.fillMaxWidth()) {
                    Text("Back")
                }
                return@Column
            }

            ProgressBlock(state)

            if (state.isDone) {
                Spacer(Modifier.heightIn(min = 8.dp))
                SummaryBlock(state)
                Button(
                    onClick = onDone,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Done")
                }
            } else {
                CurrentRecipientBlock(
                    body = state.body,
                    name = state.current?.displayName.orEmpty(),
                    number = state.current?.phoneNumber.orEmpty(),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = { vm.onSkip() },
                        modifier = Modifier.weight(1f),
                    ) { Text("Skip") }
                    Button(
                        onClick = {
                            val number = state.current?.phoneNumber ?: return@Button
                            launcher.launch(buildSendToIntent(number, state.body))
                        },
                        modifier = Modifier.weight(1f),
                    ) {
                        Icon(Icons.AutoMirrored.Outlined.Send, contentDescription = null)
                        Spacer(Modifier.heightIn(min = 0.dp))
                        Text("  Send")
                    }
                }
                Text(
                    "Tapping Send opens your Messages app with the message pre-filled. " +
                        "Tap Send there, then come back to continue.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun ProgressBlock(state: SendQueueState) {
    val total = state.totalCount.coerceAtLeast(1)
    val done = state.currentIndex
    val fraction = (done.toFloat() / total.toFloat()).coerceIn(0f, 1f)
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            "Recipient $done of ${state.totalCount}",
            style = MaterialTheme.typography.labelLarge,
        )
        LinearProgressIndicator(
            progress = { fraction },
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun CurrentRecipientBlock(body: String, name: String, number: String) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        tonalElevation = 1.dp,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text("Up next", style = MaterialTheme.typography.labelMedium)
            Text(
                name,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                number,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.heightIn(min = 4.dp))
            Text("Message", style = MaterialTheme.typography.labelMedium)
            Text(body, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
private fun SummaryBlock(state: SendQueueState) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        tonalElevation = 1.dp,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Box(modifier = Modifier.padding(16.dp), contentAlignment = Alignment.CenterStart) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("All done.", style = MaterialTheme.typography.titleMedium)
                Text(
                    "Sent: ${state.sentCount}   Skipped: ${state.skippedCount}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

private fun buildSendToIntent(phoneNumber: String, body: String): Intent =
    Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:$phoneNumber")).apply {
        putExtra("sms_body", body)
    }
