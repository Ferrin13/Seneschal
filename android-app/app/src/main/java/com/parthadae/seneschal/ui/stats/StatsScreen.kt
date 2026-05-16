package com.parthadae.seneschal.ui.stats

import androidx.compose.foundation.background
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
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
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
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.TemporalAdjusters
import javax.inject.Inject

enum class StatsRange(val label: String) { Today("Today"), Week("Week"), Month("Month") }

/**
 * One row in the stats list: time spent on a specific activity with a
 * specific (possibly empty) `notes` value. Two slots with the same
 * activity but different notes intentionally produce separate rows so
 * the user can see how time splits across the variants they typed.
 */
data class ActivityNotesTotal(
    val activity: Activity,
    val category: Category,
    val notes: String?,
    val totalMs: Long,
)

data class StatsUiState(
    val range: StatsRange = StatsRange.Today,
    val totals: List<ActivityNotesTotal> = emptyList(),
    val totalLoggedMs: Long = 0L,
)

@HiltViewModel
class StatsViewModel @Inject constructor(
    slotRepo: TimeSlotRepository,
    activityRepo: ActivityRepository,
) : ViewModel() {
    private val _range = MutableStateFlow(StatsRange.Today)
    val range: StateFlow<StatsRange> = _range.asStateFlow()

    private val zone = ZoneId.systemDefault()

    @OptIn(ExperimentalCoroutinesApi::class)
    val state: StateFlow<StatsUiState> = _range.flatMapLatest { range ->
        val (fromMs, toMs) = rangeBounds(range)
        combine(
            slotRepo.observeRange(fromMs, toMs),
            activityRepo.activitiesById,
            activityRepo.categoriesById,
        ) { slots, actsById, catsById ->
            buildState(range, slots, actsById, catsById)
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), StatsUiState())

    fun setRange(r: StatsRange) { _range.value = r }

    private fun rangeBounds(range: StatsRange): Pair<Long, Long> {
        val today = LocalDate.now(zone)
        val (start, end) = when (range) {
            StatsRange.Today -> today to today.plusDays(1)
            StatsRange.Week -> {
                val monday = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
                monday to monday.plusDays(7)
            }
            StatsRange.Month -> {
                val first = today.withDayOfMonth(1)
                first to first.plusMonths(1)
            }
        }
        val fromMs = start.atStartOfDay(zone).toInstant().toEpochMilli()
        val toMs = end.atStartOfDay(zone).toInstant().toEpochMilli()
        return fromMs to toMs
    }

    private fun buildState(
        range: StatsRange,
        slots: List<TimeSlot>,
        actsById: Map<String, Activity>,
        catsById: Map<String, Category>,
    ): StatsUiState {
        // Key on (activityId, normalizedNotes) so identical notes collapse
        // into one row but distinct notes (including null vs. typed) split.
        // Pair is hashable, which a Triple-with-null isn't always friendly
        // with in older Kotlin stdlibs.
        val totalsMs = HashMap<Pair<String, String?>, Long>()
        var loggedMs = 0L
        slots.forEach { s ->
            val activityId = s.primaryActivityId ?: return@forEach
            // Treat blank notes as "no notes" so accidental whitespace
            // doesn't fragment a row.
            val key = activityId to s.notes?.trim()?.takeIf { it.isNotEmpty() }
            totalsMs[key] = (totalsMs[key] ?: 0L) + SLOT_MS
            loggedMs += SLOT_MS
        }
        val totals = totalsMs.entries
            .mapNotNull { (key, ms) ->
                val (activityId, notes) = key
                val act = actsById[activityId] ?: return@mapNotNull null
                val cat = catsById[act.categoryId] ?: return@mapNotNull null
                ActivityNotesTotal(activity = act, category = cat, notes = notes, totalMs = ms)
            }
            .sortedByDescending { it.totalMs }
        return StatsUiState(range = range, totals = totals, totalLoggedMs = loggedMs)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StatsScreen(
    vm: StatsViewModel = hiltViewModel(),
    onNavigateHome: (() -> Unit)? = null,
) {
    val state by vm.state.collectAsStateWithLifecycle()
    var selectedIndex by remember { mutableStateOf(0) }

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
                        selected = i == selectedIndex,
                        onClick = {
                            selectedIndex = i
                            vm.setRange(r)
                        },
                        shape = SegmentedButtonDefaults.itemShape(i, StatsRange.entries.size),
                        label = { Text(r.label) },
                    )
                }
            }
            Spacer(Modifier.height(16.dp))
            StackedBar(state.totals)
            Spacer(Modifier.height(8.dp))
            Text(
                "Logged ${formatHm(state.totalLoggedMs)} this ${state.range.label.lowercase()}",
                style = MaterialTheme.typography.labelMedium,
            )
            Spacer(Modifier.height(16.dp))
            LazyColumn(modifier = Modifier.fillMaxSize()) {
                items(
                    state.totals,
                    // Activity + notes uniquely identify a row; without an
                    // explicit key, identical activity names with different
                    // notes can confuse Compose's diffing.
                    key = { "${it.activity.id}|${it.notes ?: ""}" },
                ) { row -> ActivityNotesRow(row, state.totalLoggedMs) }
            }
        }
    }
}

@Composable
private fun StackedBar(totals: List<ActivityNotesTotal>) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(14.dp)
            .clip(RoundedCornerShape(7.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant),
    ) {
        val total = totals.sumOf { it.totalMs }.coerceAtLeast(1L)
        totals.forEach { row ->
            val w = row.totalMs.toFloat() / total.toFloat()
            if (w > 0f) {
                Box(
                    modifier = Modifier
                        .weight(w)
                        .fillMaxWidth()
                        .background(row.category.color),
                )
            }
        }
    }
}

@Composable
private fun ActivityNotesRow(row: ActivityNotesTotal, totalLoggedMs: Long) {
    val pct = if (totalLoggedMs > 0)
        (row.totalMs * 100f / totalLoggedMs).toInt() else 0
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.weight(1f),
        ) {
            Box(
                modifier = Modifier
                    .size(12.dp)
                    .background(row.category.color, CircleShape),
            )
            Spacer(Modifier.size(8.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(row.activity.name, fontWeight = FontWeight.Medium)
                row.notes?.let {
                    Text(
                        text = it,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        Text("${formatHm(row.totalMs)} · ${pct}%")
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
