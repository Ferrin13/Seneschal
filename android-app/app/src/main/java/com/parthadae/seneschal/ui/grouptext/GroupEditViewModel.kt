package com.parthadae.seneschal.ui.grouptext

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.parthadae.seneschal.data.repository.GroupMemberRepository
import com.parthadae.seneschal.data.repository.GroupRepository
import com.parthadae.seneschal.domain.GroupMember
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject

data class GroupEditUiState(
    val loading: Boolean = true,
    val isNew: Boolean = true,
    /**
     * Server group id once the row exists. For a new group we generate
     * this up-front so members can be added (and FK-resolved locally)
     * before the user taps Save.
     */
    val groupId: String = "",
    val name: String = "",
    val saving: Boolean = false,
    val saved: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class GroupEditViewModel @Inject constructor(
    private val groupRepository: GroupRepository,
    private val groupMemberRepository: GroupMemberRepository,
    private val pickedContactsHolder: PickedContactsHolder,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {
    private val argGroupId: String? = savedStateHandle["groupId"]

    private val _state = MutableStateFlow(
        GroupEditUiState(
            isNew = argGroupId == null,
            groupId = argGroupId ?: UUID.randomUUID().toString(),
        )
    )
    val state: StateFlow<GroupEditUiState> = _state.asStateFlow()

    /**
     * Members live in their own table and are upserted independently.
     * Observing here keeps the editor live even if a sync push lands
     * mid-edit. For a brand-new group the FK won't resolve to any rows
     * yet, which is fine — the flow is just empty.
     */
    val members: StateFlow<List<GroupMember>> = run {
        val flow = groupMemberRepository.observeForGroup(_state.value.groupId)
        flow.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
    }

    init {
        viewModelScope.launch {
            val existing = argGroupId?.let { groupRepository.byId(it) }
            _state.value = _state.value.copy(
                loading = false,
                isNew = existing == null,
                name = existing?.name.orEmpty(),
            )
        }
        // Observe the multi-select contacts picker's hand-off. The picker
        // writes a non-null list on confirm; we bulk-add then clear the
        // holder so a back-press without re-confirming doesn't replay.
        viewModelScope.launch {
            pickedContactsHolder.picked.filterNotNull().collect { picks ->
                pickedContactsHolder.consume()
                addMembers(picks)
            }
        }
    }

    fun setName(text: String) {
        _state.value = _state.value.copy(name = text)
    }

    fun save() {
        val s = _state.value
        if (s.saving) return
        if (s.name.isBlank()) {
            _state.value = s.copy(error = "Give your group a name.")
            return
        }
        _state.value = s.copy(saving = true, error = null)
        viewModelScope.launch {
            try {
                groupRepository.upsert(id = s.groupId, name = s.name.trim())
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
        val id = _state.value.groupId
        if (_state.value.isNew) {
            // Nothing persisted yet; just dismiss.
            _state.value = _state.value.copy(saved = true)
            return
        }
        viewModelScope.launch {
            groupRepository.delete(id)
            _state.value = _state.value.copy(saved = true)
        }
    }

    /**
     * Persist new members in a single batch. We auto-save the parent
     * group on the first add for a brand-new group so the FK resolves on
     * the server side (the local Room FK is satisfied because Room
     * enforces FKs lazily via the outbox upsert ordering, but the server
     * group row also needs to exist before the member upserts land).
     *
     * Existing members with the same normalized phone number are skipped
     * so re-picking from the contacts list doesn't duplicate them.
     */
    fun addMembers(picks: List<PickedContact>) {
        if (picks.isEmpty()) return
        viewModelScope.launch {
            try {
                ensureGroupSaved()
                val existing = groupMemberRepository.forGroup(_state.value.groupId)
                    .map { it.phoneNumber.filter { c -> !c.isWhitespace() } }
                    .toSet()
                for (p in picks) {
                    val normalized = p.phoneNumber.filter { c -> !c.isWhitespace() }
                    if (normalized in existing) continue
                    groupMemberRepository.upsert(
                        groupId = _state.value.groupId,
                        displayName = p.displayName,
                        phoneNumber = p.phoneNumber,
                        contactLookupKey = p.contactLookupKey,
                    )
                }
            } catch (t: Throwable) {
                _state.value = _state.value.copy(
                    error = "Couldn't add members: ${t.message ?: t.javaClass.simpleName}",
                )
            }
        }
    }

    fun removeMember(memberId: String) {
        viewModelScope.launch {
            groupMemberRepository.delete(memberId)
        }
    }

    private suspend fun ensureGroupSaved() {
        val s = _state.value
        if (groupRepository.byId(s.groupId) != null) return
        val name = s.name.ifBlank { "Untitled group" }
        groupRepository.upsert(id = s.groupId, name = name)
        _state.value = _state.value.copy(name = name, isNew = false)
    }
}
