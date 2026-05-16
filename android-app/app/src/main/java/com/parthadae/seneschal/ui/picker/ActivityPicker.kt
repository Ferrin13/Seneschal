package com.parthadae.seneschal.ui.picker

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.parthadae.seneschal.data.repository.ActivityRepository
import com.parthadae.seneschal.domain.Activity
import com.parthadae.seneschal.domain.Category
import com.parthadae.seneschal.domain.SLOT_MS
import com.parthadae.seneschal.domain.slotsForDay
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import javax.inject.Inject

data class PickerResult(
    val activityId: String,
    val secondaryActivityId: String? = null,
    val notes: String? = null,
)

data class PickerState(
    val categories: List<Category> = emptyList(),
    val activities: List<Activity> = emptyList(),
    val recents: List<Activity> = emptyList(),
    val recentNotes: List<String> = emptyList(),
)

@HiltViewModel
class ActivityPickerViewModel @Inject constructor(
    repo: ActivityRepository,
) : ViewModel() {
    val state: StateFlow<PickerState> = combine(
        repo.categories,
        repo.activities,
        repo.recentActivities(8),
        repo.recentNotes(8),
    ) { cats, acts, recents, recentNotes ->
        PickerState(cats, acts, recents, recentNotes)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), PickerState())
}

/**
 * Bottom sheet for picking an activity for a 15-minute slot range.
 *
 * Single-slot edit is just a 1-slot range, so the picker is one component.
 *
 * - Tap an activity → commits with current notes/range, dismiss.
 * - Long-press an activity → marks it as primary; next tap chooses the
 *   secondary (Driving + Audiobook).
 * - Long-press a Recent → same secondary flow.
 * - Notes field is always visible; leave empty to skip notes.
 * - From / To pills open a 15-minute slot list so the user can tweak
 *   the range before saving.
 *
 * If `range` is non-null, the From/To row is rendered. Pass null only
 * for the "Start timer" case where range editing is meaningless. The
 * sheet has no header or close button — swipe down to dismiss.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ActivityPickerSheet(
    onDismiss: () -> Unit,
    onPick: (PickerResult) -> Unit,
    range: LongRangeMs? = null,
    onRangeChange: ((LongRangeMs) -> Unit)? = null,
    existingPrimaryActivityId: String? = null,
    existingSecondaryActivityId: String? = null,
    existingNotes: String? = null,
    allowSecondary: Boolean = true,
    onClear: (() -> Unit)? = null,
    vm: ActivityPickerViewModel = hiltViewModel(),
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val state by vm.state.collectAsStateWithLifecycle()

    var pendingPrimary by remember { mutableStateOf<Activity?>(null) }
    var notes by rememberSaveable(existingNotes) { mutableStateOf(existingNotes.orEmpty()) }
    val expanded = remember { mutableStateMapOf<String, Boolean>() }

    val initialActivity = remember(existingPrimaryActivityId, state.activities) {
        existingPrimaryActivityId?.let { id -> state.activities.firstOrNull { it.id == id } }
    }

    var fromPickerOpen by remember { mutableStateOf(false) }
    var toPickerOpen by remember { mutableStateOf(false) }

    fun finish(result: PickerResult) {
        scope.launch {
            sheetState.hide()
            onPick(result)
            onDismiss()
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp),
        ) {
            // Only surface a header in the secondary-pick flow, where the
            // user needs the reminder of which primary they tapped. The
            // From/To row below already conveys the slot range.
            pendingPrimary?.let {
                Text(
                    text = "Pick secondary for ${it.name}",
                    style = MaterialTheme.typography.titleSmall,
                    modifier = Modifier.padding(bottom = 4.dp),
                )
            }

            // Inline range editor (skipped for the timer case where range is null).
            if (range != null && onRangeChange != null) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.padding(vertical = 4.dp),
                ) {
                    Text("From", style = MaterialTheme.typography.labelMedium)
                    OutlinedButton(
                        onClick = { fromPickerOpen = true },
                        modifier = Modifier.padding(start = 8.dp),
                    ) { Text(formatTime(range.fromMs)) }
                    Text(
                        "To",
                        style = MaterialTheme.typography.labelMedium,
                        modifier = Modifier.padding(start = 16.dp),
                    )
                    OutlinedButton(
                        onClick = { toPickerOpen = true },
                        modifier = Modifier.padding(start = 8.dp),
                    ) { Text(formatTime(range.endExclusiveMs)) }
                    Text(
                        text = " · ${formatDuration(range.durationMs)}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(start = 8.dp),
                    )
                }
            }

            OutlinedTextField(
                value = notes,
                onValueChange = { notes = it },
                placeholder = { Text("Optional details") },
                singleLine = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 4.dp),
            )

            if (state.recentNotes.isNotEmpty()) {
                LazyRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    contentPadding = PaddingValues(vertical = 4.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    items(state.recentNotes) { note ->
                        RecentNoteChip(
                            label = note,
                            onClick = { notes = note },
                        )
                    }
                }
            }

            // When editing a range that already has a uniform primary, allow
            // committing notes-only (or range-only) edits without re-tapping
            // the same activity.
            if (initialActivity != null && pendingPrimary == null) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "Currently: ${initialActivity.name}",
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.weight(1f),
                    )
                    if (onClear != null) {
                        TextButton(
                            onClick = {
                                scope.launch {
                                    sheetState.hide()
                                    onClear()
                                    onDismiss()
                                }
                            },
                            modifier = Modifier.padding(end = 4.dp),
                        ) { Text("Clear") }
                    }
                    Button(
                        onClick = {
                            finish(
                                PickerResult(
                                    activityId = initialActivity.id,
                                    secondaryActivityId = existingSecondaryActivityId,
                                    notes = notes.ifBlank { null },
                                )
                            )
                        },
                    ) { Text("Save") }
                }
            }

            if (pendingPrimary == null && state.recents.isNotEmpty()) {
                Text(
                    "Recent",
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(top = 8.dp),
                )
                LazyRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    contentPadding = PaddingValues(vertical = 8.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    items(state.recents) { act ->
                        val cat = state.categories.firstOrNull { it.id == act.categoryId }
                        RecentChip(
                            label = act.name,
                            color = cat?.color ?: Color.Gray,
                            onClick = {
                                finish(
                                    PickerResult(
                                        activityId = act.id,
                                        notes = notes.ifBlank { null },
                                    )
                                )
                            },
                            onLongClick = {
                                if (allowSecondary) {
                                    pendingPrimary = act
                                } else {
                                    finish(
                                        PickerResult(
                                            activityId = act.id,
                                            notes = notes.ifBlank { null },
                                        )
                                    )
                                }
                            },
                        )
                    }
                }
                HorizontalDivider()
            }

            val grouped = remember(state.categories, state.activities) {
                state.categories.map { c -> c to state.activities.filter { it.categoryId == c.id } }
            }
            LazyColumn(modifier = Modifier.fillMaxWidth()) {
                grouped.forEach { (category, acts) ->
                    if (acts.isEmpty()) return@forEach
                    val isOpen = expanded[category.id] == true
                    item(key = "h-${category.id}") {
                        CategoryHeader(
                            category = category,
                            count = acts.size,
                            expanded = isOpen,
                            onToggle = { expanded[category.id] = !isOpen },
                        )
                    }
                    if (isOpen) {
                        items(acts, key = { "a-${it.id}" }) { act ->
                            ActivityRow(
                                activity = act,
                                color = category.color,
                                onTap = {
                                    if (pendingPrimary == null) {
                                        finish(
                                            PickerResult(
                                                activityId = act.id,
                                                notes = notes.ifBlank { null },
                                            )
                                        )
                                    } else {
                                        finish(
                                            PickerResult(
                                                activityId = pendingPrimary!!.id,
                                                secondaryActivityId = act.id,
                                                notes = notes.ifBlank { null },
                                            )
                                        )
                                    }
                                },
                                onLongPress = {
                                    if (pendingPrimary == null && allowSecondary) {
                                        pendingPrimary = act
                                    }
                                },
                            )
                        }
                    }
                }
            }
        }
    }

    // 15-minute slot pickers (one tap to commit, no separate OK button).
    if (range != null && onRangeChange != null) {
        if (fromPickerOpen) {
            SlotListDialog(
                title = "Start time",
                initialMs = range.fromMs,
                forEnd = false,
                onDismiss = { fromPickerOpen = false },
                onPick = { picked ->
                    val newFrom = picked.coerceAtMost(range.toMs)
                    onRangeChange(LongRangeMs(newFrom, range.toMs))
                    fromPickerOpen = false
                },
            )
        }
        if (toPickerOpen) {
            SlotListDialog(
                title = "End time",
                initialMs = range.endExclusiveMs,
                forEnd = true,
                onDismiss = { toPickerOpen = false },
                onPick = { pickedExclusive ->
                    val newToInclusive = (pickedExclusive - SLOT_MS).coerceAtLeast(range.fromMs)
                    onRangeChange(LongRangeMs(range.fromMs, newToInclusive))
                    toPickerOpen = false
                },
            )
        }
    }
}

/**
 * Inclusive-on-both-ends 15-minute slot range. `fromMs` and `toMs` are
 * both slot starts. A 1-slot range has fromMs == toMs.
 */
data class LongRangeMs(val fromMs: Long, val toMs: Long) {
    init { require(fromMs <= toMs) { "fromMs ($fromMs) must be <= toMs ($toMs)" } }
    val endExclusiveMs: Long get() = toMs + SLOT_MS
    val durationMs: Long get() = endExclusiveMs - fromMs
    val slotCount: Int get() = (durationMs / SLOT_MS).toInt()
}

/**
 * Scrollable list of 15-minute slot times for one calendar day. One tap
 * commits the selection.
 *
 * - `forEnd = false`: list contains slot starts (12:00 AM ... 11:45 PM).
 *   Picking 10:15 means "range starts at 10:15".
 * - `forEnd = true`: list contains slot ends (12:15 AM ... 12:00 AM next day).
 *   Picking 11:00 means "range ends at 11:00 AM exclusive" (last slot is 10:45).
 */
@Composable
private fun SlotListDialog(
    title: String,
    initialMs: Long,
    forEnd: Boolean,
    onDismiss: () -> Unit,
    onPick: (Long) -> Unit,
) {
    val zone = remember { ZoneId.systemDefault() }
    val date = remember(initialMs) {
        Instant.ofEpochMilli(initialMs).atZone(zone).toLocalDate()
    }
    val items = remember(date, forEnd) {
        val starts = slotsForDay(date, zone)
        if (forEnd) starts.map { it + SLOT_MS } else starts
    }
    val initialIndex = remember(items, initialMs) {
        items.indexOf(initialMs).let { if (it < 0) 0 else it }
    }
    // Center the initial selection a little above the middle of the viewport.
    val listState = rememberLazyListState(
        initialFirstVisibleItemIndex = (initialIndex - 4).coerceAtLeast(0),
    )

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            LazyColumn(
                state = listState,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(360.dp),
            ) {
                items(items) { ms ->
                    val selected = ms == initialMs
                    Surface(
                        onClick = { onPick(ms) },
                        color = if (selected)
                            MaterialTheme.colorScheme.primaryContainer
                        else
                            MaterialTheme.colorScheme.surface,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(
                            text = formatTime(ms),
                            style = MaterialTheme.typography.bodyLarge,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                        )
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
    )
}

private val TIME_FMT = DateTimeFormatter.ofPattern("h:mm a", Locale.getDefault())

private fun formatTime(epochMs: Long): String =
    TIME_FMT.format(Instant.ofEpochMilli(epochMs).atZone(ZoneId.systemDefault()))

private fun formatDuration(ms: Long): String {
    val totalMin = ms / 60_000L
    val h = totalMin / 60
    val m = totalMin % 60
    return when {
        h > 0 && m > 0 -> "${h}h ${m}m"
        h > 0 -> "${h}h"
        else -> "${m}m"
    }
}


@Composable
private fun CategoryHeader(
    category: Category,
    count: Int,
    expanded: Boolean,
    onToggle: () -> Unit,
) {
    Surface(
        onClick = onToggle,
        shape = RoundedCornerShape(10.dp),
        color = category.color.copy(alpha = if (expanded) 0.16f else 0.08f),
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 6.dp, bottom = 2.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 10.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(10.dp)
                    .background(category.color, CircleShape),
            )
            Text(
                category.name,
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier
                    .padding(start = 8.dp)
                    .weight(1f),
            )
            Text(
                count.toString(),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(end = 8.dp),
            )
            Icon(
                if (expanded) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,
                contentDescription = if (expanded) "Collapse" else "Expand",
            )
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ActivityRow(
    activity: Activity,
    color: Color,
    onTap: () -> Unit,
    onLongPress: () -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = color.copy(alpha = 0.10f),
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 2.dp)
            .combinedClickable(onClick = onTap, onLongClick = onLongPress),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .background(color, CircleShape),
            )
            Text(
                activity.name,
                modifier = Modifier
                    .padding(start = 12.dp)
                    .weight(1f),
            )
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun RecentChip(
    label: String,
    color: Color,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(50),
        color = color.copy(alpha = 0.18f),
        modifier = Modifier.combinedClickable(
            onClick = onClick,
            onLongClick = onLongClick,
        ),
    ) {
        Text(
            label,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
            style = MaterialTheme.typography.labelLarge,
        )
    }
}

/**
 * Notes have no category color, so the chip uses surfaceVariant for a
 * neutral fill that still reads as a tappable pill alongside the
 * activity recents above.
 */
@Composable
private fun RecentNoteChip(
    label: String,
    onClick: () -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(50),
        color = MaterialTheme.colorScheme.surfaceVariant,
        onClick = onClick,
    ) {
        Text(
            label,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
            style = MaterialTheme.typography.labelLarge,
        )
    }
}
