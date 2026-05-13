package com.parthadae.seneschal.ui.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.parthadae.seneschal.BuildConfig
import com.parthadae.seneschal.auth.AuthRepository
import com.parthadae.seneschal.auth.AuthState
import com.parthadae.seneschal.data.local.PendingMutationDao
import com.parthadae.seneschal.sync.SyncScheduler
import com.parthadae.seneschal.sync.SyncStatus
import com.parthadae.seneschal.sync.SyncStatusRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import javax.inject.Inject

data class SettingsUiState(
    val auth: AuthState = AuthState.SignedOut,
    val pendingCount: Int = 0,
    val sync: SyncStatus = SyncStatus(),
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val syncScheduler: SyncScheduler,
    pendingMutationDao: PendingMutationDao,
    syncStatusRepository: SyncStatusRepository,
) : ViewModel() {
    val state: StateFlow<SettingsUiState> = combine(
        authRepository.authState,
        pendingMutationDao.observeCount(),
        syncStatusRepository.status,
    ) { auth, pending, sync -> SettingsUiState(auth, pending, sync) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), SettingsUiState())

    fun syncNow() = syncScheduler.requestImmediateSync()

    fun signOut() {
        viewModelScope.launch { runCatching { authRepository.signOut() } }
    }
}

private val TIME_FMT = DateTimeFormatter.ofPattern("h:mm:ss a")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(vm: SettingsViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()

    Scaffold(
        topBar = { TopAppBar(title = { Text("Settings") }) },
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .padding(16.dp),
        ) {
            (state.auth as? AuthState.SignedIn)?.let { signed ->
                Text("Signed in as", style = MaterialTheme.typography.labelMedium)
                Text(
                    signed.email ?: signed.displayName ?: signed.uid,
                    style = MaterialTheme.typography.titleMedium,
                )
            }
            Spacer(Modifier.height(24.dp))
            HorizontalDivider()
            Spacer(Modifier.height(24.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("Sync", style = MaterialTheme.typography.titleSmall)
                    Text(
                        "${state.pendingCount} pending change(s)",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    val sync = state.sync
                    if (sync.running) {
                        Text("Syncing…", style = MaterialTheme.typography.bodySmall)
                    } else if (sync.lastSuccessAtMs != null) {
                        Text(
                            "Last success: ${formatTime(sync.lastSuccessAtMs)}",
                            style = MaterialTheme.typography.bodySmall,
                        )
                    } else if (sync.lastAttemptAtMs != null) {
                        Text(
                            "Last attempt: ${formatTime(sync.lastAttemptAtMs)}",
                            style = MaterialTheme.typography.bodySmall,
                        )
                    } else {
                        Text("Never synced yet", style = MaterialTheme.typography.bodySmall)
                    }
                    sync.lastError?.let {
                        Text(
                            "Error: $it",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                }
                OutlinedButton(onClick = { vm.syncNow() }) { Text("Sync now") }
            }

            Spacer(Modifier.height(16.dp))
            Text(
                "API: ${BuildConfig.API_BASE_URL}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Spacer(Modifier.height(24.dp))
            HorizontalDivider()
            Spacer(Modifier.height(24.dp))

            OutlinedButton(
                onClick = { scope.launch { vm.signOut() } },
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Sign out") }
        }
    }
}

private fun formatTime(epochMs: Long): String =
    TIME_FMT.format(Instant.ofEpochMilli(epochMs).atZone(ZoneId.systemDefault()))
