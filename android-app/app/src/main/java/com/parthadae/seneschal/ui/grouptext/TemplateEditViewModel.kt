package com.parthadae.seneschal.ui.grouptext

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.parthadae.seneschal.data.repository.MessageTemplateRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject

data class TemplateEditUiState(
    val loading: Boolean = true,
    val isNew: Boolean = true,
    val title: String = "",
    val body: String = "",
    val saving: Boolean = false,
    val saved: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class TemplateEditViewModel @Inject constructor(
    private val messageTemplateRepository: MessageTemplateRepository,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {
    private val templateId: String? = savedStateHandle["templateId"]

    private val _state = MutableStateFlow(TemplateEditUiState(isNew = templateId == null))
    val state: StateFlow<TemplateEditUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            val existing = templateId?.let { messageTemplateRepository.byId(it) }
            _state.value = _state.value.copy(
                loading = false,
                isNew = existing == null,
                title = existing?.title.orEmpty(),
                body = existing?.body.orEmpty(),
            )
        }
    }

    fun setTitle(text: String) {
        _state.value = _state.value.copy(title = text)
    }

    fun setBody(text: String) {
        _state.value = _state.value.copy(body = text)
    }

    fun save() {
        val s = _state.value
        if (s.saving) return
        if (s.title.isBlank()) {
            _state.value = s.copy(error = "Give your template a title.")
            return
        }
        if (s.body.isBlank()) {
            _state.value = s.copy(error = "The message body can't be empty.")
            return
        }
        _state.value = s.copy(saving = true, error = null)
        viewModelScope.launch {
            try {
                messageTemplateRepository.upsert(
                    id = templateId ?: UUID.randomUUID().toString(),
                    title = s.title.trim(),
                    body = s.body,
                )
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
        val id = templateId ?: return
        viewModelScope.launch {
            messageTemplateRepository.delete(id)
            _state.value = _state.value.copy(saved = true)
        }
    }
}
