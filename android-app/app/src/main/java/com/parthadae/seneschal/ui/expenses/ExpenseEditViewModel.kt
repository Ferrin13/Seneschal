package com.parthadae.seneschal.ui.expenses

import android.net.Uri
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.parthadae.seneschal.data.repository.BusinessRepository
import com.parthadae.seneschal.data.repository.ExpenseRepository
import com.parthadae.seneschal.data.repository.ImageRepository
import com.parthadae.seneschal.data.repository.LocalImageHandle
import com.parthadae.seneschal.domain.Business
import com.parthadae.seneschal.domain.Expense
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import javax.inject.Inject

data class ExpenseEditUiState(
    val loading: Boolean = true,
    val isNew: Boolean = true,
    val businesses: List<Business> = emptyList(),
    val businessId: String? = null,
    val occurredAt: Instant = Instant.now(),
    /** User-typed amount, in dollars (e.g. "12.34"). Empty = no amount. */
    val amountText: String = "",
    val note: String = "",
    /** Existing remote image, if any. */
    val imageKey: String? = null,
    /** Local cached path for an image that hasn't been uploaded yet. */
    val pendingImagePath: String? = null,
    val pendingImageContentType: String? = null,
    val pendingImageSizeBytes: Long? = null,
    val saving: Boolean = false,
    val saved: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class ExpenseEditViewModel @Inject constructor(
    private val expenseRepository: ExpenseRepository,
    private val businessRepository: BusinessRepository,
    private val imageRepository: ImageRepository,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {
    private val expenseId: String? = savedStateHandle["expenseId"]

    private val _state = MutableStateFlow(ExpenseEditUiState(isNew = expenseId == null))
    val state: StateFlow<ExpenseEditUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            val businesses = businessRepository.businesses.first()
            val existing: Expense? = expenseId?.let { expenseRepository.byId(it) }
            _state.value = _state.value.copy(
                loading = false,
                isNew = existing == null,
                businesses = businesses,
                businessId = existing?.businessId ?: businesses.firstOrNull()?.id,
                occurredAt = existing?.occurredAt ?: Instant.now(),
                amountText = existing?.amountCents?.let { formatDollars(it) } ?: "",
                note = existing?.note.orEmpty(),
                imageKey = existing?.imageKey,
                pendingImagePath = existing?.localImagePath,
            )
        }
    }

    fun setBusiness(id: String) {
        _state.value = _state.value.copy(businessId = id)
    }

    fun setOccurredDate(date: LocalDate) {
        val zone = ZoneId.systemDefault()
        val current = _state.value.occurredAt.atZone(zone).toLocalDateTime()
        val next = LocalDateTime.of(date, current.toLocalTime())
        _state.value = _state.value.copy(occurredAt = next.atZone(zone).toInstant())
    }

    fun setOccurredTime(time: LocalTime) {
        val zone = ZoneId.systemDefault()
        val current = _state.value.occurredAt.atZone(zone).toLocalDateTime()
        val next = LocalDateTime.of(current.toLocalDate(), time)
        _state.value = _state.value.copy(occurredAt = next.atZone(zone).toInstant())
    }

    fun setAmountText(text: String) {
        // Allow only digits and at most one dot, with up to 2 decimals.
        val sanitized = text.filter { it.isDigit() || it == '.' }
        val parts = sanitized.split('.')
        val cleaned = when {
            parts.size <= 1 -> sanitized
            parts.size == 2 -> parts[0] + "." + parts[1].take(2)
            else -> parts[0] + "." + parts.drop(1).joinToString("").take(2)
        }
        _state.value = _state.value.copy(amountText = cleaned)
    }

    fun setNote(text: String) {
        _state.value = _state.value.copy(note = text)
    }

    fun pickImage(uri: Uri) {
        viewModelScope.launch {
            try {
                val handle: LocalImageHandle = imageRepository.attachImage(uri)
                _state.value = _state.value.copy(
                    pendingImagePath = handle.localPath,
                    pendingImageContentType = handle.contentType,
                    pendingImageSizeBytes = handle.sizeBytes,
                    error = null,
                )
            } catch (t: Throwable) {
                _state.value = _state.value.copy(error = "Couldn't load image: ${t.message}")
            }
        }
    }

    fun clearPendingImage() {
        val path = _state.value.pendingImagePath
        if (path != null) imageRepository.deleteLocal(path)
        _state.value = _state.value.copy(
            pendingImagePath = null,
            pendingImageContentType = null,
            pendingImageSizeBytes = null,
        )
    }

    fun save() {
        val s = _state.value
        if (s.saving) return
        val businessId = s.businessId
        if (businessId == null) {
            _state.value = s.copy(error = "Pick a business first.")
            return
        }
        val amountCents = parseDollarsToCents(s.amountText)
        if (s.amountText.isNotBlank() && amountCents == null) {
            _state.value = s.copy(error = "Amount must be a number.")
            return
        }
        _state.value = s.copy(saving = true, error = null)

        viewModelScope.launch {
            try {
                val newPendingPath = s.pendingImagePath?.takeIf { path ->
                    // Only enqueue an upload if this is a fresh attachment
                    // (no pre-existing image, or path differs from what
                    // was already on the row).
                    val existing = expenseId?.let { expenseRepository.byId(it) }
                    existing?.localImagePath != path
                }

                val savedId = expenseRepository.upsert(
                    id = expenseId ?: java.util.UUID.randomUUID().toString(),
                    businessId = businessId,
                    occurredAt = s.occurredAt,
                    amountCents = amountCents,
                    note = s.note.ifBlank { null },
                    localImagePath = s.pendingImagePath,
                    imageKey = s.imageKey,
                )

                if (newPendingPath != null && s.pendingImageContentType != null && s.pendingImageSizeBytes != null) {
                    imageRepository.enqueueUpload(
                        handle = LocalImageHandle(
                            localPath = newPendingPath,
                            contentType = s.pendingImageContentType,
                            sizeBytes = s.pendingImageSizeBytes,
                        ),
                        ownerKind = ExpenseRepository.OWNER_KIND,
                        ownerId = savedId,
                        purpose = "expense_image",
                    )
                }
                _state.value = _state.value.copy(saving = false, saved = true)
            } catch (t: Throwable) {
                _state.value = _state.value.copy(
                    saving = false,
                    error = "Save failed: ${t.message ?: t.javaClass.simpleName}",
                )
            }
        }
    }

    fun delete() {
        val id = expenseId ?: return
        viewModelScope.launch {
            expenseRepository.delete(id)
            _state.value = _state.value.copy(saved = true)
        }
    }
}

private fun formatDollars(cents: Int): String {
    val abs = if (cents < 0) -cents else cents
    val sign = if (cents < 0) "-" else ""
    return "$sign${abs / 100}.${(abs % 100).toString().padStart(2, '0')}"
}

/** Returns cents, or null if [text] is blank/unparseable. */
private fun parseDollarsToCents(text: String): Int? {
    if (text.isBlank()) return null
    val trimmed = text.trim()
    val parts = trimmed.split('.')
    return when (parts.size) {
        1 -> parts[0].toIntOrNull()?.let { it * 100 }
        2 -> {
            val whole = parts[0].toIntOrNull() ?: return null
            val fracStr = parts[1].padEnd(2, '0').take(2)
            val frac = fracStr.toIntOrNull() ?: return null
            whole * 100 + frac
        }
        else -> null
    }
}
