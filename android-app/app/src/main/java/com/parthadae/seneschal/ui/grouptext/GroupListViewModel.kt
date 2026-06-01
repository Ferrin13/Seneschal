package com.parthadae.seneschal.ui.grouptext

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.parthadae.seneschal.data.repository.GroupRepository
import com.parthadae.seneschal.domain.GroupSummary
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject

@HiltViewModel
class GroupListViewModel @Inject constructor(
    private val groupRepository: GroupRepository,
) : ViewModel() {

    val groups: StateFlow<List<GroupSummary>> = groupRepository.groupSummaries
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
}
