package com.parthadae.seneschal.ui.stats

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DateRangePicker
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberDateRangePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.parthadae.seneschal.data.repository.ActivityRepository
import com.parthadae.seneschal.data.repository.TimeSlotRepository
import com.parthadae.seneschal.domain.Activity
import com.parthadae.seneschal.domain.Category
import com.parthadae.seneschal.domain.SLOT_MS
import com.parthadae.seneschal.domain.TimeSlot
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import javax.inject.Inject

enum class StatsRange(val label: String) {
    Today("Today"),
    Week("7 Days"),
    Custom("Custom"),
}

/** Inclusive-on-both-ends span of calendar days for the Custom range. */
data class DateRange(val start: LocalDate, val endInclusive: LocalDate)

/**
 * Time spent on one specific (possibly empty) `notes` value within a single
 * activity. These are the sub-sections shown under each activity group.
 */
data class NoteTotal(
    val notes: String?,
    val totalMs: Long,
)

/**
 * One activity group in the stats list. Slots where this activity is either the
 * primary or the secondary activity are aggregated together regardless of
 * notes, then the time is broken down per distinct note in [notes] (sorted by
 * time spent). [secondaryMs] is the portion of [totalMs] that came from slots
 * where this was the secondary activity.
 */
data class ActivityTotal(
    val activity: Activity,
    val category: Category,
    val totalMs: Long,
    val secondaryMs: Long,
    val notes: List<NoteTotal>,
)

data class StatsUiState(
    val range: StatsRange = StatsRange.Today,
    /** Human-readable suffix for the "Logged Xh …" summary line. */
    val rangeDescription: String = "today",
    val activities: List<ActivityTotal> = emptyList(),
    val totalLoggedMs: Long = 0L,
)

@HiltViewModel
class StatsViewModel @Inject constructor(
    slotRepo: TimeSlotRepository,
    activityRepo: ActivityRepository,
) : ViewModel() {
    private val zone = ZoneId.systemDefault()

    private val _range = MutableStateFlow(StatsRange.Today)
    val range: StateFlow<StatsRange> = _range.asStateFlow()

    private val _customRange = MutableStateFlow(defaultCustomRange())
    val customRange: StateFlow<DateRange> = _customRange.asStateFlow()

    @OptIn(ExperimentalCoroutinesApi::class)
    val state: StateFlow<StatsUiState> =
        combine(_range, _customRange) { range, custom -> range to custom }
            .flatMapLatest { (range, custom) ->
                val (fromMs, toMs) = rangeBounds(range, custom)
                combine(
                    slotRepo.observeRange(fromMs, toMs),
                    activityRepo.activitiesById,
                    activityRepo.categoriesById,
                ) { slots, actsById, catsById ->
                    buildState(range, custom, slots, actsById, catsById)
                }
            }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), StatsUiState())

    fun setRange(r: StatsRange) { _range.value = r }

    fun setCustomRange(start: LocalDate, endInclusive: LocalDate) {
        // Guard against the picker handing back an inverted range.
        val (s, e) = if (start <= endInclusive) start to endInclusive else endInclusive to start
        _customRange.value = DateRange(s, e)
        _range.value = StatsRange.Custom
    }

    private fun defaultCustomRange(): DateRange {
        val today = LocalDate.now(zone)
        return DateRange(today.minusDays(29), today)
    }

    private fun rangeBounds(range: StatsRange, custom: DateRange): Pair<Long, Long> {
        val today = LocalDate.now(zone)
        val (start, end) = when (range) {
            StatsRange.Today -> today to today.plusDays(1)
            // "Last 7 days": today plus the six preceding days.
            StatsRange.Week -> today.minusDays(6) to today.plusDays(1)
            // Inclusive end date, so advance one day for the half-open upper bound.
            StatsRange.Custom -> custom.start to custom.endInclusive.plusDays(1)
        }
        val fromMs = start.atStartOfDay(zone).toInstant().toEpochMilli()
        val toMs = end.atStartOfDay(zone).toInstant().toEpochMilli()
        return fromMs to toMs
    }

    private fun describeRange(range: StatsRange, custom: DateRange): String = when (range) {
        StatsRange.Today -> "today"
        StatsRange.Week -> "in the last 7 days"
        StatsRange.Custom -> {
            val fmt = DateTimeFormatter.ofPattern("MMM d")
            "from ${fmt.format(custom.start)} to ${fmt.format(custom.endInclusive)}"
        }
    }

    private fun buildState(
        range: StatsRange,
        custom: DateRange,
        slots: List<TimeSlot>,
        actsById: Map<String, Activity>,
        catsById: Map<String, Category>,
    ): StatsUiState {
        // First tally time per (activityId, normalizedNotes). Blank notes are
        // treated as "no notes" so accidental whitespace doesn't fragment a row.
        // Each slot contributes to its primary activity and, when present, to
        // its secondary activity (e.g. "Driving + Audiobook" credits both).
        val totalsMs = HashMap<Pair<String, String?>, Long>()
        val secondaryMsByActivity = HashMap<String, Long>()
        var loggedMs = 0L
        slots.forEach { s ->
            val notes = s.notes?.trim()?.takeIf { it.isNotEmpty() }
            s.primaryActivityId?.let { activityId ->
                val key = activityId to notes
                totalsMs[key] = (totalsMs[key] ?: 0L) + SLOT_MS
                loggedMs += SLOT_MS
            }
            s.secondaryActivityId?.let { activityId ->
                // Notes describe the primary activity (e.g. the audiobook
                // title on "Audiobook + Driving"), so secondary credit goes
                // to the activity's "no notes" bucket rather than fragmenting
                // it by the primary's notes.
                val key: Pair<String, String?> = activityId to null
                totalsMs[key] = (totalsMs[key] ?: 0L) + SLOT_MS
                secondaryMsByActivity[activityId] =
                    (secondaryMsByActivity[activityId] ?: 0L) + SLOT_MS
            }
        }

        // Then roll the per-notes tallies up into one group per activity, with
        // the note variants kept as sub-sections.
        val notesByActivity = HashMap<String, MutableList<NoteTotal>>()
        val activityTotalMs = HashMap<String, Long>()
        totalsMs.forEach { (key, ms) ->
            val (activityId, notes) = key
            notesByActivity.getOrPut(activityId) { mutableListOf() }.add(NoteTotal(notes, ms))
            activityTotalMs[activityId] = (activityTotalMs[activityId] ?: 0L) + ms
        }

        val activities = notesByActivity.entries
            .mapNotNull { (activityId, noteTotals) ->
                val act = actsById[activityId] ?: return@mapNotNull null
                val cat = catsById[act.categoryId] ?: return@mapNotNull null
                ActivityTotal(
                    activity = act,
                    category = cat,
                    totalMs = activityTotalMs[activityId] ?: 0L,
                    secondaryMs = secondaryMsByActivity[activityId] ?: 0L,
                    notes = noteTotals.sortedByDescending { it.totalMs },
                )
            }
            .sortedByDescending { it.totalMs }

        return StatsUiState(
            range = range,
            rangeDescription = describeRange(range, custom),
            activities = activities,
            totalLoggedMs = loggedMs,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StatsScreen(
    vm: StatsViewModel = hiltViewModel(),
    onNavigateHome: (() -> Unit)? = null,
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val customRange by vm.customRange.collectAsStateWithLifecycle()
    var showRangePicker by remember { mutableStateOf(false) }

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
                title = { Text("Stats") },
                // The outer TimeTrackingFlow Scaffold already consumes
                // the status-bar inset; suppressing the TopAppBar's own
                // default top inset prevents it from being applied a
                // second time, which otherwise leaves an empty
                // status-bar-height strip above the title row.
                windowInsets = WindowInsets(0, 0, 0, 0),
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .padding(horizontal = 16.dp),
        ) {
            Spacer(Modifier.height(8.dp))
            SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                StatsRange.entries.forEachIndexed { i, r ->
                    SegmentedButton(
                        selected = r == state.range,
                        onClick = {
                            vm.setRange(r)
                            // Picking "Custom" should immediately surface the
                            // calendar so the user can choose their window.
                            if (r == StatsRange.Custom) showRangePicker = true
                        },
                        shape = SegmentedButtonDefaults.itemShape(i, StatsRange.entries.size),
                        label = { Text(r.label) },
                    )
                }
            }
            if (state.range == StatsRange.Custom) {
                Spacer(Modifier.height(8.dp))
                CustomRangeSummary(customRange) { showRangePicker = true }
            }
            Spacer(Modifier.height(16.dp))
            StackedBar(state.activities)
            Spacer(Modifier.height(8.dp))
            Text(
                "Logged ${formatHm(state.totalLoggedMs)} ${state.rangeDescription}",
                style = MaterialTheme.typography.labelMedium,
            )
            Spacer(Modifier.height(16.dp))
            // Slots with a secondary activity credit both activities, so the
            // per-activity totals can sum past the wall-clock logged time. Base
            // the percentages on that combined sum so they stay consistent with
            // the stacked bar above (which normalizes the same way).
            val overallTotalMs = state.activities.sumOf { it.totalMs }
            LazyColumn(modifier = Modifier.fillMaxSize()) {
                items(
                    state.activities,
                    key = { it.activity.id },
                ) { group -> ActivityGroup(group, overallTotalMs) }
            }
        }
    }

    if (showRangePicker) {
        DateRangePickerDialog(
            initial = customRange,
            onConfirm = { start, end ->
                vm.setCustomRange(start, end)
                showRangePicker = false
            },
            onDismiss = { showRangePicker = false },
        )
    }
}

@Composable
private fun CustomRangeSummary(range: DateRange, onClick: () -> Unit) {
    val fmt = DateTimeFormatter.ofPattern("MMM d, yyyy")
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 4.dp),
    ) {
        Icon(
            Icons.Outlined.Edit,
            contentDescription = "Change date range",
            modifier = Modifier.size(16.dp),
            tint = MaterialTheme.colorScheme.primary,
        )
        Spacer(Modifier.size(8.dp))
        Text(
            "${fmt.format(range.start)}  –  ${fmt.format(range.endInclusive)}",
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DateRangePickerDialog(
    initial: DateRange,
    onConfirm: (LocalDate, LocalDate) -> Unit,
    onDismiss: () -> Unit,
) {
    // Material's date picker works in UTC-midnight epoch millis, so convert
    // through ZoneOffset.UTC in both directions to avoid off-by-one days.
    val pickerState = rememberDateRangePickerState(
        initialSelectedStartDateMillis = initial.start.toUtcMillis(),
        initialSelectedEndDateMillis = initial.endInclusive.toUtcMillis(),
    )
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(
                onClick = {
                    val s = pickerState.selectedStartDateMillis
                    val e = pickerState.selectedEndDateMillis
                    if (s != null && e != null) {
                        onConfirm(s.toUtcLocalDate(), e.toUtcLocalDate())
                    }
                },
                enabled = pickerState.selectedStartDateMillis != null &&
                    pickerState.selectedEndDateMillis != null,
            ) { Text("OK") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
    ) {
        DateRangePicker(state = pickerState)
    }
}

private fun LocalDate.toUtcMillis(): Long =
    atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()

private fun Long.toUtcLocalDate(): LocalDate =
    Instant.ofEpochMilli(this).atZone(ZoneOffset.UTC).toLocalDate()

@Composable
private fun StackedBar(activities: List<ActivityTotal>) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(14.dp)
            .clip(RoundedCornerShape(7.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant),
    ) {
        val total = activities.sumOf { it.totalMs }.coerceAtLeast(1L)
        activities.forEach { group ->
            val w = group.totalMs.toFloat() / total.toFloat()
            if (w > 0f) {
                Box(
                    modifier = Modifier
                        .weight(w)
                        .fillMaxWidth()
                        .background(group.category.color),
                )
            }
        }
    }
}

@Composable
private fun ActivityGroup(group: ActivityTotal, overallTotalMs: Long) {
    val pct = if (overallTotalMs > 0)
        (group.totalMs * 100f / overallTotalMs).toInt() else 0
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        // Activity header: color dot, name, and the activity's combined total.
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.weight(1f),
            ) {
                Box(
                    modifier = Modifier
                        .size(12.dp)
                        .background(group.category.color, CircleShape),
                )
                Spacer(Modifier.size(8.dp))
                Text(group.activity.name, fontWeight = FontWeight.Medium)
                // Note how much of this activity's time was logged alongside a
                // primary activity rather than as the main one.
                if (group.secondaryMs > 0) {
                    Spacer(Modifier.size(6.dp))
                    Text(
                        "(${formatHm(group.secondaryMs)} as secondary)",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            Text("${formatHm(group.totalMs)} · ${pct}%")
        }
        // Note breakdown sub-sections. Skip when the only entry is "no notes",
        // since the header already conveys that total.
        val showNotes = group.notes.size > 1 || group.notes.firstOrNull()?.notes != null
        if (showNotes) {
            group.notes.forEach { note ->
                NoteRow(note, group.totalMs)
            }
        }
    }
}

@Composable
private fun NoteRow(note: NoteTotal, activityTotalMs: Long) {
    val pct = if (activityTotalMs > 0)
        (note.totalMs * 100f / activityTotalMs).toInt() else 0
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
        modifier = Modifier
            .fillMaxWidth()
            // Indent so notes nest visually under the activity name.
            .padding(start = 20.dp, top = 6.dp),
    ) {
        Text(
            text = note.notes ?: "No notes",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontStyle = if (note.notes == null) FontStyle.Italic else FontStyle.Normal,
            modifier = Modifier.weight(1f),
        )
        Spacer(Modifier.size(8.dp))
        Text(
            "${formatHm(note.totalMs)} · ${pct}%",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
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
