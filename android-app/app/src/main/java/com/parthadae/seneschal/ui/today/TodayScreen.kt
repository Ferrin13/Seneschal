package com.parthadae.seneschal.ui.today

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.ChevronLeft
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.parthadae.seneschal.domain.SLOT_MS
import com.parthadae.seneschal.ui.picker.ActivityPickerSheet
import com.parthadae.seneschal.ui.picker.LongRangeMs
import com.parthadae.seneschal.ui.picker.PickerResult
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val DAY_HEADER_FMT = DateTimeFormatter.ofPattern("EEEE, MMM d", Locale.getDefault())
private val SLOT_TIME_FMT = DateTimeFormatter.ofPattern("h:mm a", Locale.getDefault())

@Composable
fun TodayScreen(
    vm: TodayViewModel = hiltViewModel(),
    onNavigateHome: (() -> Unit)? = null,
) {
    val state by vm.state.collectAsStateWithLifecycle()
    // Recomposes once a minute while a timer is running so the FAB's
    // elapsed counter stays current without burning cycles every second.
    val nowMs = rememberMinuteTicker()

    // Single picker state. A single-tap on a slot opens the picker with a
    // 1-slot range; a long-press + tap opens it with the spanning range.
    var pickerRange by remember { mutableStateOf<LongRangeMs?>(null) }
    var pickerForTimer by remember { mutableStateOf(false) }
    var rangeAnchor by remember { mutableStateOf<Long?>(null) }
    var rangeOther by remember { mutableStateOf<Long?>(null) }

    Scaffold(
        // The outer TimeTrackingFlow Scaffold already consumes the status
        // bar inset. Without this override, Material3 Scaffold's default
        // contentWindowInsets (safeDrawing) would apply that inset a
        // second time and leave a chunk of empty space above the day row.
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        floatingActionButton = {
            val timer = state.timer
            if (timer == null) {
                FloatingActionButton(onClick = { pickerForTimer = true }) {
                    Icon(Icons.Filled.PlayArrow, contentDescription = "Start timer")
                }
            } else {
                val elapsed = (nowMs - timer.startedAtMs).coerceAtLeast(0L)
                ExtendedFloatingActionButton(
                    text = {
                        val name = state.timerActivity?.name ?: "(timer)"
                        val started = formatSlotLabel(timer.startedAtMs)
                        Text("$name · since $started · ${formatHm(elapsed)}")
                    },
                    icon = { Icon(Icons.Filled.Stop, contentDescription = "Stop timer") },
                    onClick = { vm.stopTimer() },
                )
            }
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize(),
        ) {
            // Compact day header: back-to-home (if available) + day stepper.
            // Replaces the previous TopAppBar so we don't reserve a whole
            // app-bar's worth of empty space above the day content.
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 4.dp),
            ) {
                if (onNavigateHome != null) {
                    IconButton(onClick = onNavigateHome) {
                        Icon(
                            Icons.AutoMirrored.Outlined.ArrowBack,
                            contentDescription = "Back to home",
                        )
                    }
                } else {
                    Spacer(Modifier.width(8.dp))
                }
                IconButton(onClick = { vm.previousDay() }) {
                    Icon(Icons.Outlined.ChevronLeft, "Previous day")
                }
                Text(
                    text = state.date.format(DAY_HEADER_FMT),
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.padding(horizontal = 4.dp),
                )
                IconButton(
                    onClick = { vm.nextDay() },
                    enabled = state.date < LocalDate.now(),
                ) {
                    Icon(Icons.Outlined.ChevronRight, "Next day")
                }
            }

            CategoryBreakdownBar(
                totals = state.categoryTotalsMs,
                colorByCategory = state.slots
                    .mapNotNull { it.primaryCategory }
                    .associate { it.id to it.color },
                totalLoggedMs = state.totalLoggedMs,
            )

            val isToday = state.date == LocalDate.now()
            // For "today", default to showing slots up through the current
            // 15-minute bucket. Extend the visible window to include:
            //  - any slot the user has already populated (so writes to
            //    future slots appear immediately after the picker closes),
            //  - the End-time of the picker while it's open (so the user
            //    can see the slots they're about to fill), and
            //  - any in-progress long-press range selection.
            val latestSetMs = state.slots
                .asSequence()
                .filter { it.primary != null }
                .maxOfOrNull { it.slotStartMs } ?: Long.MIN_VALUE
            val pendingPickerMs = pickerRange?.toMs ?: Long.MIN_VALUE
            val pendingRangeMs = maxOf(
                rangeAnchor ?: Long.MIN_VALUE,
                rangeOther ?: Long.MIN_VALUE,
            )
            val visibleSlots = if (!isToday) {
                // Past or future days: show every slot.
                state.slots
            } else {
                val cutoffMs = maxOf(
                    System.currentTimeMillis(),
                    latestSetMs,
                    pendingPickerMs,
                    pendingRangeMs,
                )
                state.slots.filter { it.slotStartMs <= cutoffMs + SLOT_MS }
            }

            val anchor = rangeAnchor
            val other = rangeOther

            LazyColumn(modifier = Modifier.fillMaxSize()) {
                items(visibleSlots, key = { it.slotStartMs }) { slot ->
                    val isSelected = anchor != null &&
                        slot.slotStartMs >= minOf(anchor, other ?: anchor) &&
                        slot.slotStartMs <= maxOf(anchor, other ?: anchor)
                    SlotRow(
                        slot = slot,
                        selected = isSelected,
                        inRangeMode = anchor != null,
                        onTap = {
                            if (anchor == null) {
                                pickerRange = LongRangeMs(slot.slotStartMs, slot.slotStartMs)
                            } else {
                                val from = minOf(anchor, slot.slotStartMs)
                                val to = maxOf(anchor, slot.slotStartMs)
                                pickerRange = LongRangeMs(from, to)
                                rangeAnchor = null
                                rangeOther = null
                            }
                        },
                        onLongPress = {
                            if (anchor == null) {
                                // First long-press: arm range mode at this slot.
                                rangeAnchor = slot.slotStartMs
                                rangeOther = slot.slotStartMs
                            } else {
                                // Second long-press: commit the spanning range.
                                val from = minOf(anchor, slot.slotStartMs)
                                val to = maxOf(anchor, slot.slotStartMs)
                                pickerRange = LongRangeMs(from, to)
                                rangeAnchor = null
                                rangeOther = null
                            }
                        },
                    )
                }
            }
        }
    }

    pickerRange?.let { range ->
        // Derive existing primary/secondary/notes from the slots in range.
        // "Uniform" means every populated slot agrees; we ignore empty
        // slots so extending a range into the future (or into gaps) still
        // shows the Save button. Tapping Save fills the empty slots with
        // the same activity.
        val slotsInRange = state.slots.filter {
            it.slotStartMs in range.fromMs..range.toMs
        }
        val primaryIds = slotsInRange.mapNotNull { it.primary?.id }.distinct()
        val uniformPrimaryId = primaryIds.singleOrNull()

        val secondaryIds = slotsInRange.mapNotNull { it.secondary?.id }.distinct()
        val uniformSecondaryId = secondaryIds.singleOrNull()

        val noteValues = slotsInRange
            .mapNotNull { it.notes?.takeIf { n -> n.isNotBlank() } }
            .distinct()
        val uniformNotes = noteValues.singleOrNull()

        ActivityPickerSheet(
            range = range,
            onRangeChange = { newRange -> pickerRange = newRange },
            existingPrimaryActivityId = uniformPrimaryId,
            existingSecondaryActivityId = uniformSecondaryId,
            existingNotes = uniformNotes,
            onDismiss = { pickerRange = null },
            onPick = { result ->
                val current = pickerRange ?: range
                vm.setRange(
                    fromMs = current.fromMs,
                    toMs = current.toMs,
                    activityId = result.activityId,
                    secondaryId = result.secondaryActivityId,
                    notes = result.notes,
                )
            },
            onClear = {
                val current = pickerRange ?: range
                vm.clearRange(current.fromMs, current.toMs)
            },
        )
    }

    if (pickerForTimer) {
        ActivityPickerSheet(
            onDismiss = { pickerForTimer = false },
            onPick = { result: PickerResult ->
                vm.startTimer(
                    activityId = result.activityId,
                    secondaryId = result.secondaryActivityId,
                    notes = result.notes,
                )
            },
        )
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun SlotRow(
    slot: TodaySlot,
    selected: Boolean,
    @Suppress("UNUSED_PARAMETER") inRangeMode: Boolean,
    onTap: () -> Unit,
    onLongPress: () -> Unit,
) {
    val baseColor = slot.primaryCategory?.color ?: Color.Transparent
    val bg = when {
        selected -> MaterialTheme.colorScheme.primary.copy(alpha = 0.18f)
        slot.primary != null -> baseColor.copy(alpha = 0.10f)
        else -> Color.Transparent
    }
    Surface(
        color = bg,
        shape = RoundedCornerShape(8.dp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 2.dp)
            .combinedClickable(onClick = onTap, onLongClick = onLongPress),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = formatSlotLabel(slot.slotStartMs),
                style = MaterialTheme.typography.labelMedium,
                modifier = Modifier.width(72.dp),
            )
            Box(
                modifier = Modifier
                    .size(10.dp)
                    .clip(CircleShape)
                    .background(if (slot.primary != null) baseColor else Color.LightGray.copy(alpha = 0.4f)),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                text = slot.primary?.name ?: "—",
                style = MaterialTheme.typography.bodyLarge,
                color = if (slot.primary == null)
                    MaterialTheme.colorScheme.onSurface.copy(alpha = 0.4f)
                else MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            slot.notes?.takeIf { it.isNotBlank() }?.let { notes ->
                Spacer(Modifier.width(8.dp))
                Text(
                    text = notes,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
                    maxLines = 1,
                    overflow = TextOverflow.Clip,
                    modifier = Modifier.weight(1f, fill = false),
                )
            } ?: Spacer(Modifier.weight(1f))
            slot.secondary?.let {
                Spacer(Modifier.width(8.dp))
                Text(
                    text = "+ ${it.name}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                )
            }
        }
    }
}

@Composable
private fun CategoryBreakdownBar(
    totals: Map<String, Long>,
    colorByCategory: Map<String, Color>,
    totalLoggedMs: Long,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(10.dp)
                .clip(RoundedCornerShape(5.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant),
        ) {
            val total = totals.values.sum().coerceAtLeast(1L)
            totals.forEach { (catId, ms) ->
                val color = colorByCategory[catId] ?: return@forEach
                val weight = ms.toFloat() / total.toFloat()
                if (weight <= 0f) return@forEach
                Box(
                    modifier = Modifier
                        .weight(weight)
                        .fillMaxWidth()
                        .background(color),
                )
            }
        }
        Text(
            text = "Logged ${formatHm(totalLoggedMs)} today",
            style = MaterialTheme.typography.labelMedium,
            modifier = Modifier.padding(top = 4.dp),
        )
    }
}

private fun formatSlotLabel(ms: Long): String {
    val zdt = Instant.ofEpochMilli(ms).atZone(ZoneId.systemDefault())
    return SLOT_TIME_FMT.format(zdt)
}

private fun formatHm(ms: Long): String {
    val totalMin = (ms / 60_000L)
    val h = totalMin / 60
    val m = totalMin % 60
    return when {
        h > 0 && m > 0 -> "${h}h ${m}m"
        h > 0 -> "${h}h"
        else -> "${m}m"
    }
}

/**
 * Returns the current epoch ms, recomposing once per wall-clock minute
 * boundary. Aligning to the boundary (rather than ticking every 60s
 * regardless of phase) keeps the displayed elapsed value correct as it
 * crosses the next minute, instead of drifting up to ~59s late.
 */
@Composable
private fun rememberMinuteTicker(): Long {
    val state = remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            val now = System.currentTimeMillis()
            state.longValue = now
            val msUntilNextMinute = 60_000L - (now % 60_000L)
            kotlinx.coroutines.delay(msUntilNextMinute)
        }
    }
    return state.longValue
}
