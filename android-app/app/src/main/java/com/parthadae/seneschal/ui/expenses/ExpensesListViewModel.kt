package com.parthadae.seneschal.ui.expenses

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.parthadae.seneschal.data.repository.BusinessRepository
import com.parthadae.seneschal.data.repository.ExpenseRepository
import com.parthadae.seneschal.domain.Business
import com.parthadae.seneschal.domain.Expense
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ExpensesListUiState(
    val expenses: List<Expense> = emptyList(),
    val businessesById: Map<String, Business> = emptyMap(),
)

@HiltViewModel
class ExpensesListViewModel @Inject constructor(
    private val expenseRepository: ExpenseRepository,
    businessRepository: BusinessRepository,
) : ViewModel() {

    val state: StateFlow<ExpensesListUiState> = combine(
        expenseRepository.expenses,
        businessRepository.businessesById,
    ) { expenses, byId ->
        ExpensesListUiState(expenses = expenses, businessesById = byId)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ExpensesListUiState())

    fun delete(id: String) {
        viewModelScope.launch { expenseRepository.delete(id) }
    }
}
