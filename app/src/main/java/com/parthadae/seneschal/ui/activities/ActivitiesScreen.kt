package com.parthadae.seneschal.ui.activities

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Unarchive
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.parthadae.seneschal.data.local.ActivityDao
import com.parthadae.seneschal.data.local.CategoryDao
import com.parthadae.seneschal.data.repository.ActivityRepository
import com.parthadae.seneschal.domain.Activity
import com.parthadae.seneschal.domain.Category
import com.parthadae.seneschal.domain.toDomain
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ActivitiesUiState(
    val categories: List<Category> = emptyList(),
    val activitiesByCategory: Map<String, List<Activity>> = emptyMap(),
)

@HiltViewModel
class ActivitiesViewModel @Inject constructor(
    private val repo: ActivityRepository,
    categoryDao: CategoryDao,
    activityDao: ActivityDao,
) : ViewModel() {
    val uiState: StateFlow<ActivitiesUiState> = combine(
        categoryDao.observeActive().map { list -> list.map { it.toDomain() } },
        activityDao.observeAllIncludingArchived().map { list -> list.map { it.toDomain() } },
    ) { cats, acts ->
        ActivitiesUiState(
            categories = cats,
            activitiesByCategory = acts.groupBy { it.categoryId },
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ActivitiesUiState())

    fun rename(id: String, name: String) {
        viewModelScope.launch { runCatching { repo.renameActivity(id, name) } }
    }

    fun setArchived(id: String, archived: Boolean) {
        viewModelScope.launch { runCatching { repo.setActivityArchived(id, archived) } }
    }

    fun create(categoryId: String, name: String) {
        viewModelScope.launch { runCatching { repo.createActivity(categoryId, name) } }
    }

    fun renameCategory(id: String, name: String) {
        viewModelScope.launch { runCatching { repo.renameCategory(id, name) } }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ActivitiesScreen(vm: ActivitiesViewModel = hiltViewModel()) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    var addToCategory by remember { mutableStateOf<Category?>(null) }
    var renameActivity by remember { mutableStateOf<Activity?>(null) }
    var renameCategory by remember { mutableStateOf<Category?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(title = { Text("Activities") })
        },
        floatingActionButton = {
            val first = state.categories.firstOrNull()
            if (first != null) {
                FloatingActionButton(onClick = { addToCategory = first }) {
                    Icon(Icons.Outlined.Add, contentDescription = "Add activity")
                }
            }
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize(),
        ) {
            state.categories.forEach { category ->
                val acts = state.activitiesByCategory[category.id].orEmpty()
                item(key = "h-${category.id}") {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 8.dp),
                    ) {
                        Box(
                            modifier = Modifier
                                .size(12.dp)
                                .background(category.color, CircleShape),
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            category.name,
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.weight(1f),
                        )
                        IconButton(onClick = { renameCategory = category }) {
                            Icon(Icons.Outlined.Edit, contentDescription = "Rename category")
                        }
                        IconButton(onClick = { addToCategory = category }) {
                            Icon(Icons.Outlined.Add, contentDescription = "Add activity")
                        }
                    }
                }
                items(acts, key = { "a-${it.id}" }) { act ->
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(start = 32.dp, end = 16.dp, top = 4.dp, bottom = 4.dp),
                    ) {
                        Text(act.name, modifier = Modifier.weight(1f))
                        IconButton(onClick = { renameActivity = act }) {
                            Icon(Icons.Outlined.Edit, contentDescription = "Rename")
                        }
                        IconButton(onClick = { vm.setArchived(act.id, !act.isArchived) }) {
                            if (act.isArchived) {
                                Icon(Icons.Outlined.Unarchive, contentDescription = "Restore")
                            } else {
                                Icon(Icons.Outlined.Archive, contentDescription = "Archive")
                            }
                        }
                    }
                    HorizontalDivider()
                }
            }
        }
    }

    addToCategory?.let { category ->
        TextEntryDialog(
            title = "New activity in ${category.name}",
            initial = "",
            onConfirm = {
                vm.create(category.id, it)
                addToCategory = null
            },
            onDismiss = { addToCategory = null },
        )
    }
    renameActivity?.let { act ->
        TextEntryDialog(
            title = "Rename activity",
            initial = act.name,
            onConfirm = {
                vm.rename(act.id, it)
                renameActivity = null
            },
            onDismiss = { renameActivity = null },
        )
    }
    renameCategory?.let { cat ->
        TextEntryDialog(
            title = "Rename category",
            initial = cat.name,
            onConfirm = {
                vm.renameCategory(cat.id, it)
                renameCategory = null
            },
            onDismiss = { renameCategory = null },
        )
    }
}

@Composable
private fun TextEntryDialog(
    title: String,
    initial: String,
    onConfirm: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var text by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        },
        confirmButton = {
            Button(
                onClick = { if (text.isNotBlank()) onConfirm(text.trim()) },
            ) { Text("Save") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
    )
}
