package com.parthadae.seneschal.ui.today

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.parthadae.seneschal.data.repository.ActivityRepository
import com.parthadae.seneschal.data.repository.TimeSlotRepository
import com.parthadae.seneschal.data.repository.TimerRepository
import com.parthadae.seneschal.domain.Activity
import com.parthadae.seneschal.domain.Category
import com.parthadae.seneschal.domain.RunningTimer
import com.parthadae.seneschal.domain.SLOT_MS
import com.parthadae.seneschal.domain.TimeSlot
import com.parthadae.seneschal.domain.slotsForDay
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.ZoneId
import javax.inject.Inject

data class TodaySlot(
    val slotStartMs: Long,
    val primary: Activity?,
    val primaryCategory: Category?,
    val secondary: Activity?,
    val notes: String?,
)

data class TodayState(
    val date: LocalDate = LocalDate.now(),
    val slots: List<TodaySlot> = emptyList(),
    val categoryTotalsMs: Map<String, Long> = emptyMap(),
    val totalLoggedMs: Long = 0L,
    val timer: RunningTimer? = null,
    val timerActivity: Activity? = null,
    val timerCategory: Category? = null,
)

@HiltViewModel
class TodayViewModel @Inject constructor(
    private val slotRepo: TimeSlotRepository,
    private val activityRepo: ActivityRepository,
    private val timerRepo: TimerRepository,
) : ViewModel() {
    private val _date = MutableStateFlow(LocalDate.now())
    val date: StateFlow<LocalDate> = _date.asStateFlow()

    private val zone = ZoneId.systemDefault()

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    val state: StateFlow<TodayState> = _date
        .flatMapLatest { date ->
            val startMs = date.atStartOfDay(zone).toInstant().toEpochMilli()
            val endMs = date.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
            combine(
                slotRepo.observeRange(startMs, endMs),
                activityRepo.activitiesById,
                activityRepo.categoriesById,
                timerRepo.timer,
            ) { slots, actsById, catsById, timer ->
                buildState(date, slots, actsById, catsById, timer)
            }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), TodayState())

    private fun buildState(
        date: LocalDate,
        slots: List<TimeSlot>,
        actsById: Map<String, Activity>,
        catsById: Map<String, Category>,
        timer: RunningTimer?,
    ): TodayState {
        val slotMap = slots.associateBy { it.slotStartUtcMs }
        val all = slotsForDay(date, zone).map { startMs ->
            val s = slotMap[startMs]
            val primary = s?.primaryActivityId?.let(actsById::get)
            val cat = primary?.categoryId?.let(catsById::get)
            val secondary = s?.secondaryActivityId?.let(actsById::get)
            TodaySlot(
                slotStartMs = startMs,
                primary = primary,
                primaryCategory = cat,
                secondary = secondary,
                notes = s?.notes,
            )
        }

        val categoryTotals = HashMap<String, Long>()
        var loggedMs = 0L
        all.forEach { ts ->
            val cat = ts.primaryCategory ?: return@forEach
            categoryTotals[cat.id] = (categoryTotals[cat.id] ?: 0L) + SLOT_MS
            loggedMs += SLOT_MS
        }

        val timerAct = timer?.primaryActivityId?.let(actsById::get)
        val timerCat = timerAct?.categoryId?.let(catsById::get)

        return TodayState(
            date = date,
            slots = all,
            categoryTotalsMs = categoryTotals,
            totalLoggedMs = loggedMs,
            timer = timer,
            timerActivity = timerAct,
            timerCategory = timerCat,
        )
    }

    fun setDate(date: LocalDate) { _date.value = date }
    fun previousDay() { _date.value = _date.value.minusDays(1) }
    fun nextDay() { _date.value = _date.value.plusDays(1) }

    fun setSlot(slotStartMs: Long, activityId: String, secondaryId: String?, notes: String?) {
        viewModelScope.launch {
            slotRepo.setSlot(slotStartMs, activityId, secondaryId, notes)
        }
    }

    fun setRange(fromMs: Long, toMs: Long, activityId: String, secondaryId: String?, notes: String?) {
        viewModelScope.launch {
            slotRepo.setRange(fromMs, toMs, activityId, secondaryId, notes)
        }
    }

    fun clearSlot(slotStartMs: Long) {
        viewModelScope.launch { slotRepo.clearSlot(slotStartMs) }
    }

    fun startTimer(activityId: String, secondaryId: String?, notes: String?) {
        viewModelScope.launch { timerRepo.start(activityId, secondaryId, notes) }
    }

    fun stopTimer() {
        viewModelScope.launch { timerRepo.stop() }
    }
}
