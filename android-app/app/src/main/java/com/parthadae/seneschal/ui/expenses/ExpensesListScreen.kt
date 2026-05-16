package com.parthadae.seneschal.ui.expenses

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.parthadae.seneschal.data.repository.ImageRepository
import com.parthadae.seneschal.domain.Business
import com.parthadae.seneschal.domain.Expense
import java.io.File
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val ROW_DATE_FMT = DateTimeFormatter.ofPattern("EEE MMM d")
private val ROW_TIME_FMT = DateTimeFormatter.ofPattern("h:mm a")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ExpensesListScreen(
    onAdd: () -> Unit,
    onEdit: (String) -> Unit,
    onSettings: () -> Unit,
    onNavigateHome: () -> Unit,
    vm: ExpensesListViewModel = hiltViewModel(),
) {
    val state by vm.state.collectAsStateWithLifecycle()

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = onNavigateHome) {
                        Icon(
                            Icons.AutoMirrored.Outlined.ArrowBack,
                            contentDescription = "Back to home",
                        )
                    }
                },
                title = { Text("Expenses") },
                actions = {
                    IconButton(onClick = onSettings) {
                        Icon(Icons.Outlined.Settings, contentDescription = "Settings")
                    }
                },
                // The outer ExpenseTrackingFlow Scaffold already consumes
                // the status-bar inset; suppressing the TopAppBar's own
                // default top inset prevents it from being applied a
                // second time, which otherwise leaves an empty
                // status-bar-height strip above the title row.
                windowInsets = WindowInsets(0, 0, 0, 0),
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = onAdd) {
                Icon(Icons.Outlined.Add, contentDescription = "Add expense")
            }
        },
    ) { padding ->
        val groups = remember(state.expenses, state.businessesById) {
            groupExpensesByBusiness(state.expenses, state.businessesById)
        }
        // Expansion state survives recomposition (and item recycling within
        // the LazyColumn) but resets on process death; that's fine for an
        // accordion. Keyed by businessId, with "" representing expenses
        // whose business is missing or has been deleted.
        val expandedByGroup = remember { mutableStateMapOf<String, Boolean>() }

        LazyColumn(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (groups.isEmpty()) {
                item {
                    Text(
                        "No expenses yet. Tap + to add one.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 16.dp),
                    )
                }
            } else {
                items(groups, key = { it.key }) { group ->
                    BusinessGroupCard(
                        group = group,
                        expanded = expandedByGroup[group.key] == true,
                        onToggle = {
                            expandedByGroup[group.key] = !(expandedByGroup[group.key] == true)
                        },
                        onEdit = onEdit,
                    )
                }
                item { Spacer(Modifier.height(72.dp)) }
            }
        }
    }
}

private data class BusinessGroup(
    val key: String,
    val business: Business?,
    val expenses: List<Expense>,
) {
    val totalCents: Int = expenses.sumOf { it.amountCents ?: 0 }
    val hasAnyAmount: Boolean = expenses.any { it.amountCents != null }
}

private fun groupExpensesByBusiness(
    expenses: List<Expense>,
    businessesById: Map<String, Business>,
): List<BusinessGroup> = expenses
    .groupBy { it.businessId }
    .map { (id, list) ->
        BusinessGroup(
            key = id.ifEmpty { "__unknown__" },
            business = businessesById[id],
            expenses = list,
        )
    }
    .sortedWith(
        compareBy(
            { it.business == null },
            { it.business?.sortOrder ?: Int.MAX_VALUE },
            { it.business?.name?.lowercase() ?: "" },
        )
    )

@Composable
private fun BusinessGroupCard(
    group: BusinessGroup,
    expanded: Boolean,
    onToggle: () -> Unit,
    onEdit: (String) -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        tonalElevation = 1.dp,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.fillMaxWidth()) {
            GroupHeader(group = group, expanded = expanded, onToggle = onToggle)
            AnimatedVisibility(visible = expanded) {
                Column(modifier = Modifier.fillMaxWidth()) {
                    HorizontalDivider(
                        color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f),
                    )
                    group.expenses.forEachIndexed { index, expense ->
                        ExpenseEntryRow(
                            expense = expense,
                            onClick = { onEdit(expense.id) },
                        )
                        if (index < group.expenses.lastIndex) {
                            HorizontalDivider(
                                modifier = Modifier.padding(start = 80.dp),
                                color = MaterialTheme.colorScheme.outlineVariant
                                    .copy(alpha = 0.4f),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun GroupHeader(
    group: BusinessGroup,
    expanded: Boolean,
    onToggle: () -> Unit,
) {
    val rotation by animateFloatAsState(
        targetValue = if (expanded) 180f else 0f,
        label = "expense-group-chevron",
    )
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onToggle)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                group.business?.name ?: "(unknown business)",
                style = MaterialTheme.typography.titleMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                groupSubtitle(group),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (group.hasAnyAmount) {
            Text(
                formatAmount(group.totalCents),
                style = MaterialTheme.typography.titleMedium,
            )
        }
        Icon(
            Icons.Outlined.ExpandMore,
            contentDescription = if (expanded) "Collapse" else "Expand",
            modifier = Modifier.rotate(rotation),
        )
    }
}

private fun groupSubtitle(group: BusinessGroup): String {
    val count = group.expenses.size
    val noun = if (count == 1) "expense" else "expenses"
    return "$count $noun"
}

@Composable
private fun ExpenseEntryRow(
    expense: Expense,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        ExpenseThumbnail(expense, size = 48.dp)
        Column(modifier = Modifier.weight(1f)) {
            Text(
                formatDateTime(expense.occurredAt),
                style = MaterialTheme.typography.bodyMedium,
            )
            if (!expense.note.isNullOrBlank()) {
                Text(
                    expense.note,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        expense.amountCents?.let {
            Text(
                formatAmount(it),
                style = MaterialTheme.typography.titleMedium,
            )
        }
    }
}

@Composable
internal fun ExpenseThumbnail(expense: Expense, size: Dp = 56.dp) {
    when {
        expense.localImagePath != null -> {
            AsyncImage(
                model = ImageRequest.Builder(LocalContext.current)
                    .data(File(expense.localImagePath))
                    .build(),
                contentDescription = null,
                modifier = Modifier
                    .size(size)
                    .clip(RoundedCornerShape(8.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant),
            )
        }
        expense.imageKey != null -> {
            RemoteImage(imageKey = expense.imageKey, size = size)
        }
        else -> {
            Surface(
                color = MaterialTheme.colorScheme.surfaceVariant,
                shape = RoundedCornerShape(8.dp),
                modifier = Modifier.size(size),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        Icons.Outlined.Image,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f),
                    )
                }
            }
        }
    }
}

@Composable
private fun RemoteImage(imageKey: String, size: Dp) {
    val imageRepo: ImageRepository = hiltViewModel<ImageHostViewModel>().imageRepository
    var url by remember(imageKey) { mutableStateOf<String?>(null) }
    LaunchedEffect(imageKey) {
        url = runCatching { imageRepo.presignedDisplayUrl(imageKey) }.getOrNull()
    }
    if (url != null) {
        AsyncImage(
            model = url,
            contentDescription = null,
            modifier = Modifier
                .size(size)
                .clip(RoundedCornerShape(8.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant),
        )
    } else {
        Box(
            modifier = Modifier
                .size(size)
                .clip(RoundedCornerShape(8.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant),
        )
    }
}

private fun formatDateTime(at: Instant): String {
    val zone = ZoneId.systemDefault()
    val local = at.atZone(zone).toLocalDateTime()
    val today = LocalDate.now()
    val day = when (local.toLocalDate()) {
        today -> "Today"
        today.minusDays(1) -> "Yesterday"
        else -> ROW_DATE_FMT.format(local.toLocalDate())
    }
    return "$day · ${ROW_TIME_FMT.format(local.toLocalTime())}"
}

internal fun formatAmount(cents: Int): String {
    val abs = if (cents < 0) -cents else cents
    val sign = if (cents < 0) "-" else ""
    return "$sign$${abs / 100}.${(abs % 100).toString().padStart(2, '0')}"
}
