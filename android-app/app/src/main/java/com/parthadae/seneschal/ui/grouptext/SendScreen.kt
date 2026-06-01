package com.parthadae.seneschal.ui.grouptext

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.parthadae.seneschal.domain.Group
import com.parthadae.seneschal.domain.MessageTemplate
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SendScreen(
    onBack: () -> Unit,
    onStartSending: () -> Unit,
    onPickContacts: () -> Unit,
    vm: SendViewModel = hiltViewModel(),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            Icons.AutoMirrored.Outlined.ArrowBack,
                            contentDescription = "Back",
                        )
                    }
                },
                title = { Text("New send") },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            TemplatePicker(
                templates = state.templates,
                selectedId = state.selectedTemplateId,
                onSelect = vm::selectTemplate,
            )
            OutlinedTextField(
                value = state.body,
                onValueChange = vm::setBody,
                label = { Text("Message body") },
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 160.dp),
            )
            HorizontalDivider()
            GroupPicker(
                groups = state.groups,
                selectedId = state.selectedGroupId,
                memberCount = state.groupMemberCount,
                onSelect = vm::selectGroup,
            )
            HorizontalDivider()
            Text(
                "Additional recipients",
                style = MaterialTheme.typography.titleSmall,
            )
            OutlinedButton(
                onClick = onPickContacts,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(Icons.Outlined.PersonAdd, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text("Add from contacts")
            }
            state.adHocRecipients.forEachIndexed { index, recipient ->
                AdHocRow(
                    name = recipient.displayName,
                    number = recipient.phoneNumber,
                    onRemove = { vm.removeAdHoc(index) },
                )
            }
            if (state.error != null) {
                Text(
                    state.error!!,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            val totalRecipients =
                state.groupMemberCount + state.adHocRecipients.size
            Button(
                onClick = {
                    scope.launch {
                        if (vm.prepareAndStashSend()) onStartSending()
                    }
                },
                enabled = state.body.isNotBlank() && totalRecipients > 0,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Start sending ($totalRecipients)")
            }
            Spacer(Modifier.heightIn(min = 24.dp))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TemplatePicker(
    templates: List<MessageTemplate>,
    selectedId: String?,
    onSelect: (String?) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val selected = templates.firstOrNull { it.id == selectedId }
    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = !expanded }) {
        OutlinedTextField(
            value = selected?.title ?: "(no template)",
            onValueChange = {},
            readOnly = true,
            label = { Text("Template") },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier
                .menuAnchor()
                .fillMaxWidth(),
        )
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            DropdownMenuItem(
                text = { Text("(none — type custom message)") },
                onClick = {
                    onSelect(null)
                    expanded = false
                },
            )
            templates.forEach { t ->
                DropdownMenuItem(
                    text = { Text(t.title) },
                    onClick = {
                        onSelect(t.id)
                        expanded = false
                    },
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun GroupPicker(
    groups: List<Group>,
    selectedId: String?,
    memberCount: Int,
    onSelect: (String?) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val selected = groups.firstOrNull { it.id == selectedId }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        ExposedDropdownMenuBox(
            expanded = expanded,
            onExpandedChange = { expanded = !expanded },
        ) {
            OutlinedTextField(
                value = selected?.name ?: "(no group)",
                onValueChange = {},
                readOnly = true,
                label = { Text("Group") },
                trailingIcon = {
                    ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded)
                },
                modifier = Modifier
                    .menuAnchor()
                    .fillMaxWidth(),
            )
            DropdownMenu(
                expanded = expanded,
                onDismissRequest = { expanded = false },
            ) {
                DropdownMenuItem(
                    text = { Text("(none)") },
                    onClick = {
                        onSelect(null)
                        expanded = false
                    },
                )
                groups.forEach { g ->
                    DropdownMenuItem(
                        text = { Text(g.name) },
                        onClick = {
                            onSelect(g.id)
                            expanded = false
                        },
                    )
                }
            }
        }
        if (selected != null) {
            Text(
                "$memberCount ${if (memberCount == 1) "member" else "members"} in this group",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun AdHocRow(name: String, number: String, onRemove: () -> Unit) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        tonalElevation = 1.dp,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 16.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(name, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    number,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            IconButton(onClick = onRemove) {
                Icon(Icons.Outlined.Close, contentDescription = "Remove")
            }
        }
    }
}
