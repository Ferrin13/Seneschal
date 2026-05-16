package com.parthadae.seneschal.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
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
import com.parthadae.seneschal.data.local.PendingMutationEntity
import com.parthadae.seneschal.data.repository.ActivityRepository
import com.parthadae.seneschal.domain.Activity
import com.parthadae.seneschal.sync.DescribeContext
import com.parthadae.seneschal.sync.OutboxHandler
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
    val pending: List<PendingMutationEntity> = emptyList(),
    val activitiesById: Map<String, Activity> = emptyMap(),
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val syncScheduler: SyncScheduler,
    private val pendingMutationDao: PendingMutationDao,
    syncStatusRepository: SyncStatusRepository,
    activityRepository: ActivityRepository,
    handlers: Set<@JvmSuppressWildcards OutboxHandler>,
) : ViewModel() {
    private val handlersByKind: Map<String, OutboxHandler> = handlers.associateBy { it.kind }

    val state: StateFlow<SettingsUiState> = combine(
        authRepository.authState,
        pendingMutationDao.observeCount(),
        syncStatusRepository.status,
        pendingMutationDao.observeAll(),
        activityRepository.activitiesById,
    ) { auth, pending, sync, list, byId ->
        SettingsUiState(
            auth = auth,
            pendingCount = pending,
            sync = sync,
            pending = list,
            activitiesById = byId,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), SettingsUiState())

    fun syncNow() = syncScheduler.requestImmediateSync()

    fun signOut() {
        viewModelScope.launch { runCatching { authRepository.signOut() } }
    }

    fun dismissPending(id: Long) {
        viewModelScope.launch { pendingMutationDao.delete(id) }
    }

    fun dismissAllPending() {
        viewModelScope.launch { pendingMutationDao.clear() }
    }

    /** Render a pending mutation as a one-line summary for the UI. */
    fun describe(row: PendingMutationEntity, activitiesById: Map<String, Activity>): String {
        val ctx = DescribeContext(activitiesById = activitiesById)
        return handlersByKind[row.kind]?.describe(row, ctx)
            ?: "${row.kind} (${row.targetId ?: "?"})"
    }
}

private val TIME_FMT = DateTimeFormatter.ofPattern("h:mm:ss a")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    vm: SettingsViewModel = hiltViewModel(),
    onNavigateHome: (() -> Unit)? = null,
    // Callers that nest this screen inside another Scaffold which has
    // already consumed the status-bar inset (e.g. TimeTrackingFlow,
    // ExpenseTrackingFlow) should pass WindowInsets(0, 0, 0, 0) so the
    // TopAppBar doesn't apply the inset a second time and leave an
    // empty status-bar-height strip above the title.
    topAppBarWindowInsets: WindowInsets = TopAppBarDefaults.windowInsets,
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var showPending by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = {
                    if (onNavigateHome != null) {
                        IconButton(onClick = onNavigateHome) {
                            Icon(
                                Icons.AutoMirrored.Outlined.ArrowBack,
                                contentDescription = "Back to home",
                            )
                        }
                    }
                },
                title = { Text("Settings") },
                windowInsets = topAppBarWindowInsets,
            )
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .padding(horizontal = 16.dp),
        ) {
            item { Spacer(Modifier.height(16.dp)) }
            item {
                (state.auth as? AuthState.SignedIn)?.let { signed ->
                    Text("Signed in as", style = MaterialTheme.typography.labelMedium)
                    Text(
                        signed.email ?: signed.displayName ?: signed.uid,
                        style = MaterialTheme.typography.titleMedium,
                    )
                }
            }
            item {
                Spacer(Modifier.height(24.dp))
                HorizontalDivider()
                Spacer(Modifier.height(24.dp))
            }
            item { SyncSummaryRow(state, onSyncNow = vm::syncNow) }
            item {
                Spacer(Modifier.height(8.dp))
                Text(
                    "API: ${BuildConfig.API_BASE_URL}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            // Pending mutations: only surface the section if there's
            // something to look at.
            if (state.pendingCount > 0) {
                item {
                    Spacer(Modifier.height(16.dp))
                    PendingMutationsHeader(
                        count = state.pendingCount,
                        expanded = showPending,
                        onToggle = { showPending = !showPending },
                        onDismissAll = { vm.dismissAllPending() },
                    )
                }
                if (showPending) {
                    items(state.pending, key = { it.id }) { row ->
                        PendingMutationRow(
                            summary = vm.describe(row, state.activitiesById),
                            attemptCount = row.attemptCount,
                            lastError = row.lastError,
                            onDismiss = { vm.dismissPending(row.id) },
                        )
                    }
                }
            }

            item {
                Spacer(Modifier.height(24.dp))
                HorizontalDivider()
                Spacer(Modifier.height(24.dp))
            }
            item {
                OutlinedButton(
                    onClick = { scope.launch { vm.signOut() } },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Sign out") }
                Spacer(Modifier.height(16.dp))
            }
        }
    }
}

@Composable
private fun SyncSummaryRow(state: SettingsUiState, onSyncNow: () -> Unit) {
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
        OutlinedButton(onClick = onSyncNow) { Text("Sync now") }
    }
}

@Composable
private fun PendingMutationsHeader(
    count: Int,
    expanded: Boolean,
    onToggle: () -> Unit,
    onDismissAll: () -> Unit,
) {
    Surface(
        onClick = onToggle,
        shape = RoundedCornerShape(10.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text("Pending changes", style = MaterialTheme.typography.labelLarge)
                Text(
                    "$count queued · tap to ${if (expanded) "hide" else "review"}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (expanded) {
                TextButton(onClick = onDismissAll) { Text("Dismiss all") }
            }
            Icon(
                if (expanded) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,
                contentDescription = if (expanded) "Collapse" else "Expand",
            )
        }
    }
}

@Composable
private fun PendingMutationRow(
    summary: String,
    attemptCount: Int,
    lastError: String?,
    onDismiss: () -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(8.dp),
        color = MaterialTheme.colorScheme.surface,
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 8.dp),
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(summary, style = MaterialTheme.typography.bodyMedium)
                if (attemptCount > 0 || lastError != null) {
                    val parts = buildList {
                        if (attemptCount > 0) add("$attemptCount attempt(s)")
                        lastError?.let { add(it) }
                    }
                    Text(
                        parts.joinToString(" · "),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
            IconButton(onClick = onDismiss) {
                Icon(Icons.Outlined.Close, contentDescription = "Dismiss")
            }
        }
    }
}

private fun formatTime(epochMs: Long): String =
    TIME_FMT.format(Instant.ofEpochMilli(epochMs).atZone(ZoneId.systemDefault()))
