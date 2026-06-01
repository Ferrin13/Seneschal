package com.parthadae.seneschal.ui.grouptext

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.parthadae.seneschal.data.repository.MessageTemplateRepository
import com.parthadae.seneschal.domain.MessageTemplate
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject

@HiltViewModel
class TemplateListViewModel @Inject constructor(
    private val messageTemplateRepository: MessageTemplateRepository,
) : ViewModel() {

    val templates: StateFlow<List<MessageTemplate>> = messageTemplateRepository.templates
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
}
