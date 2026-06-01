package com.parthadae.seneschal.ui.grouptext

import androidx.lifecycle.ViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject

/**
 * Drives the per-recipient SMS intent chain. Holds the queued recipients
 * and current cursor; the actual `Intent` launch happens from the
 * Composable (it owns the `ActivityResultLauncher`). The VM only tracks
 * progress.
 *
 * Android does not tell us whether the user actually tapped Send inside
 * the Messages app or just backed out, so "returned from intent" is
 * treated as "this recipient is handled". The user can still Skip a
 * recipient before launching its intent if they change their mind.
 */
data class SendQueueState(
    val loading: Boolean = true,
    val body: String = "",
    val recipients: List<SendRecipient> = emptyList(),
    /** Index of the next recipient to send to. Equal to recipients.size when done. */
    val currentIndex: Int = 0,
    val sentCount: Int = 0,
    val skippedCount: Int = 0,
    val error: String? = null,
) {
    val isDone: Boolean get() = currentIndex >= recipients.size
    val current: SendRecipient? get() = recipients.getOrNull(currentIndex)
    val totalCount: Int get() = recipients.size
}

@HiltViewModel
class SendQueueViewModel @Inject constructor(
    private val pendingSendHolder: PendingSendHolder,
) : ViewModel() {
    private val _state = MutableStateFlow(SendQueueState())
    val state: StateFlow<SendQueueState> = _state.asStateFlow()

    init {
        val pending = pendingSendHolder.consume()
        _state.value = if (pending == null) {
            SendQueueState(
                loading = false,
                error = "Nothing to send. Set up a message on the previous screen.",
            )
        } else {
            SendQueueState(
                loading = false,
                body = pending.body,
                recipients = pending.recipients,
            )
        }
    }

    /** Called after the user returns from the system Messages app. */
    fun onSent() {
        val s = _state.value
        if (s.isDone) return
        _state.value = s.copy(
            currentIndex = s.currentIndex + 1,
            sentCount = s.sentCount + 1,
        )
    }

    /** Called when the user taps Skip without launching the intent. */
    fun onSkip() {
        val s = _state.value
        if (s.isDone) return
        _state.value = s.copy(
            currentIndex = s.currentIndex + 1,
            skippedCount = s.skippedCount + 1,
        )
    }
}
