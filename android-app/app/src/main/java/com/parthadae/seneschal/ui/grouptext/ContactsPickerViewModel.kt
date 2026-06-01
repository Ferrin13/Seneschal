package com.parthadae.seneschal.ui.grouptext

import android.app.Application
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.inject.Inject

data class ContactsPickerUiState(
    val loading: Boolean = false,
    val hasPermission: Boolean = false,
    /** All phone-rows from the system contacts; one entry per number. */
    val contacts: List<PickedContact> = emptyList(),
    val query: String = "",
    /**
     * Selected entries keyed by `"$displayName\u0000$phoneNumber"` so the
     * exact (name, number) pair is what's in or out of the selection;
     * letting two numbers on the same contact be picked independently.
     */
    val selectedKeys: Set<String> = emptySet(),
    val error: String? = null,
)

fun PickedContact.selectionKey(): String = "$displayName\u0000$phoneNumber"

fun filterContacts(contacts: List<PickedContact>, query: String): List<PickedContact> =
    if (query.isBlank()) contacts
    else contacts.filter { contact ->
        contact.displayName.contains(query, ignoreCase = true) ||
            contact.phoneNumber.contains(query)
    }

@HiltViewModel
class ContactsPickerViewModel @Inject constructor(
    private val app: Application,
    private val pickedContactsHolder: PickedContactsHolder,
) : ViewModel() {
    private val _state = MutableStateFlow(ContactsPickerUiState())
    val state: StateFlow<ContactsPickerUiState> = _state.asStateFlow()

    /**
     * Called by the screen after the runtime permission check resolves.
     * Triggers a (background-thread) load of all phone-data rows.
     */
    fun onPermissionResult(granted: Boolean) {
        _state.value = _state.value.copy(hasPermission = granted, error = null)
        if (granted && _state.value.contacts.isEmpty()) loadContacts()
    }

    fun setQuery(text: String) {
        _state.value = _state.value.copy(query = text)
    }

    fun toggle(contact: PickedContact) {
        val key = contact.selectionKey()
        val current = _state.value.selectedKeys
        val next = if (key in current) current - key else current + key
        _state.value = _state.value.copy(selectedKeys = next)
    }

    /**
     * Stash the chosen contacts in the shared holder for the previous
     * screen to consume. Returns the number of contacts handed off.
     */
    fun confirm(): Int {
        val s = _state.value
        val selectedSet = s.selectedKeys
        val chosen = s.contacts.filter { it.selectionKey() in selectedSet }
        pickedContactsHolder.put(chosen)
        return chosen.size
    }

    private fun loadContacts() {
        _state.value = _state.value.copy(loading = true, error = null)
        viewModelScope.launch {
            try {
                val list = withContext(Dispatchers.IO) {
                    loadAllPhoneContacts(app)
                }
                _state.value = _state.value.copy(loading = false, contacts = list)
            } catch (t: Throwable) {
                _state.value = _state.value.copy(
                    loading = false,
                    error = "Couldn't load contacts: ${t.message ?: t.javaClass.simpleName}",
                )
            }
        }
    }
}
