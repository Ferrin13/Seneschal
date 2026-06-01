package com.parthadae.seneschal.ui.grouptext

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.parthadae.seneschal.domain.GroupMember

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GroupEditScreen(
    onBack: () -> Unit,
    onPickContacts: () -> Unit,
    vm: GroupEditViewModel = hiltViewModel(),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val members by vm.members.collectAsStateWithLifecycle()

    var showDeleteConfirm by remember { mutableStateOf(false) }

    LaunchedEffect(state.saved) {
        if (state.saved) onBack()
    }

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
                title = { Text(if (state.isNew) "New group" else "Edit group") },
                actions = {
                    if (!state.isNew) {
                        IconButton(onClick = { showDeleteConfirm = true }) {
                            Icon(
                                Icons.Outlined.DeleteOutline,
                                contentDescription = "Delete group",
                            )
                        }
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize(),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                OutlinedTextField(
                    value = state.name,
                    onValueChange = vm::setName,
                    label = { Text("Group name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                if (state.error != null) {
                    Text(
                        state.error!!,
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                OutlinedButton(
                    onClick = onPickContacts,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Icon(Icons.Outlined.PersonAdd, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Add from contacts")
                }
                Button(
                    onClick = vm::save,
                    enabled = !state.saving,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(if (state.saving) "Saving..." else "Save")
                }
            }
            HorizontalDivider()
            MembersList(
                members = members,
                onRemove = vm::removeMember,
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
            )
        }
    }

    if (showDeleteConfirm) {
        AlertDialog(
            onDismissRequest = { showDeleteConfirm = false },
            title = { Text("Delete group?") },
            text = { Text("Members will not be deleted, but this group will be removed from your account.") },
            confirmButton = {
                TextButton(onClick = {
                    showDeleteConfirm = false
                    vm.delete()
                }) { Text("Delete") }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteConfirm = false }) { Text("Cancel") }
            },
        )
    }

}

@Composable
private fun MembersList(
    members: List<GroupMember>,
    onRemove: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (members.isEmpty()) {
        Box(modifier = modifier.padding(24.dp), contentAlignment = Alignment.TopCenter) {
            Text(
                "No members yet. Tap \u201CAdd from contacts\u201D above.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        return
    }
    LazyColumn(
        modifier = modifier,
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(members, key = { it.id }) { m ->
            MemberRow(member = m, onRemove = { onRemove(m.id) })
        }
        item { Spacer(Modifier.height(72.dp)) }
    }
}

@Composable
private fun MemberRow(member: GroupMember, onRemove: () -> Unit) {
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
                Text(
                    member.displayName,
                    style = MaterialTheme.typography.bodyLarge,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    member.phoneNumber,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            IconButton(onClick = onRemove) {
                Icon(Icons.Outlined.Close, contentDescription = "Remove member")
            }
        }
    }
}
