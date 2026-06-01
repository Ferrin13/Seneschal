package com.parthadae.seneschal.ui.grouptext

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.parthadae.seneschal.data.repository.GroupMemberRepository
import com.parthadae.seneschal.data.repository.GroupRepository
import com.parthadae.seneschal.data.repository.MessageTemplateRepository
import com.parthadae.seneschal.domain.Group
import com.parthadae.seneschal.domain.MessageTemplate
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SendUiState(
    val loading: Boolean = true,
    val templates: List<MessageTemplate> = emptyList(),
    val groups: List<Group> = emptyList(),
    val selectedTemplateId: String? = null,
    val selectedGroupId: String? = null,
    val body: String = "",
    /** Members of the selected group (snapshot at selection time). */
    val groupMemberCount: Int = 0,
    /**
     * Ad-hoc recipients added via the contacts picker on the send screen,
     * on top of the chosen group's members.
     */
    val adHocRecipients: List<SendRecipient> = emptyList(),
    val error: String? = null,
)

@HiltViewModel
class SendViewModel @Inject constructor(
    private val templateRepository: MessageTemplateRepository,
    private val groupRepository: GroupRepository,
    private val groupMemberRepository: GroupMemberRepository,
    private val pendingSendHolder: PendingSendHolder,
    private val pickedContactsHolder: PickedContactsHolder,
) : ViewModel() {
    private val _state = MutableStateFlow(SendUiState())
    val state: StateFlow<SendUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            val templates = templateRepository.templates.first()
            val groups = groupRepository.groups.first()
            _state.value = _state.value.copy(
                loading = false,
                templates = templates,
                groups = groups,
                selectedTemplateId = templates.firstOrNull()?.id,
                selectedGroupId = groups.firstOrNull()?.id,
                body = templates.firstOrNull()?.body.orEmpty(),
            )
            refreshMemberCount()
        }
        // Same hand-off pattern as GroupEditViewModel: the multi-select
        // picker stashes a list on confirm, we drain it once into our
        // ad-hoc list.
        viewModelScope.launch {
            pickedContactsHolder.picked.filterNotNull().collect { picks ->
                pickedContactsHolder.consume()
                addAdHocFromContacts(picks)
            }
        }
    }

    fun selectTemplate(id: String?) {
        val template = _state.value.templates.firstOrNull { it.id == id }
        _state.value = _state.value.copy(
            selectedTemplateId = id,
            body = template?.body ?: _state.value.body,
        )
    }

    fun selectGroup(id: String?) {
        _state.value = _state.value.copy(selectedGroupId = id)
        refreshMemberCount()
    }

    fun setBody(text: String) {
        _state.value = _state.value.copy(body = text)
    }

    fun addAdHocFromContacts(picks: List<PickedContact>) {
        if (picks.isEmpty()) return
        val existing = _state.value.adHocRecipients
            .map { it.phoneNumber.filter { c -> !c.isWhitespace() } }
            .toMutableSet()
        val additions = mutableListOf<SendRecipient>()
        for (p in picks) {
            if (p.phoneNumber.isBlank()) continue
            val normalized = p.phoneNumber.filter { c -> !c.isWhitespace() }
            if (normalized in existing) continue
            existing += normalized
            additions += SendRecipient(
                displayName = p.displayName.ifBlank { p.phoneNumber },
                phoneNumber = p.phoneNumber.trim(),
            )
        }
        if (additions.isEmpty()) return
        _state.value = _state.value.copy(
            adHocRecipients = _state.value.adHocRecipients + additions,
        )
    }

    fun removeAdHoc(index: Int) {
        val list = _state.value.adHocRecipients.toMutableList()
        if (index in list.indices) list.removeAt(index)
        _state.value = _state.value.copy(adHocRecipients = list)
    }

    /**
     * Build the final recipient list and stash it for the queue screen to
     * pick up. Returns true if there's at least one recipient and a
     * non-blank body — the screen routes onward only on true.
     */
    suspend fun prepareAndStashSend(): Boolean {
        val s = _state.value
        if (s.body.isBlank()) {
            _state.value = s.copy(error = "Message body can't be empty.")
            return false
        }
        val groupRecipients = s.selectedGroupId?.let { id ->
            groupMemberRepository.forGroup(id).map {
                SendRecipient(displayName = it.displayName, phoneNumber = it.phoneNumber)
            }
        }.orEmpty()

        // De-dupe by E.164-ish phone number (best-effort: trimmed).
        val combined = (groupRecipients + s.adHocRecipients)
            .distinctBy { it.phoneNumber.filter { c -> !c.isWhitespace() } }
        if (combined.isEmpty()) {
            _state.value = s.copy(error = "Pick a group or add at least one recipient.")
            return false
        }
        pendingSendHolder.put(PendingSend(body = s.body, recipients = combined))
        _state.value = s.copy(error = null)
        return true
    }

    private fun refreshMemberCount() {
        val groupId = _state.value.selectedGroupId
        if (groupId == null) {
            _state.value = _state.value.copy(groupMemberCount = 0)
            return
        }
        viewModelScope.launch {
            val count = groupMemberRepository.forGroup(groupId).size
            _state.value = _state.value.copy(groupMemberCount = count)
        }
    }
}
