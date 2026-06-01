package com.parthadae.seneschal.ui.grouptext

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle

/**
 * Multi-select contacts picker. Requests `READ_CONTACTS` at runtime, then
 * shows every phone-row in the system contacts as a checkbox list with
 * a search filter. On Done, the selection is stashed in the singleton
 * [PickedContactsHolder] and we pop back to the launching screen, which
 * observes the holder and bulk-adds the picks.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ContactsPickerScreen(
    onBack: () -> Unit,
    vm: ContactsPickerViewModel = hiltViewModel(),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val context = LocalContext.current

    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission(),
    ) { granted ->
        vm.onPermissionResult(granted)
    }

    // On first composition, check whether we already have permission;
    // request it if not.
    LaunchedEffect(Unit) {
        val granted = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.READ_CONTACTS,
        ) == PackageManager.PERMISSION_GRANTED
        if (granted) {
            vm.onPermissionResult(true)
        } else {
            permissionLauncher.launch(Manifest.permission.READ_CONTACTS)
        }
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
                title = {
                    val count = state.selectedKeys.size
                    Text(
                        if (count == 0) "Select contacts"
                        else "$count selected"
                    )
                },
                actions = {
                    IconButton(
                        onClick = {
                            vm.confirm()
                            onBack()
                        },
                        enabled = state.selectedKeys.isNotEmpty(),
                    ) {
                        Icon(Icons.Outlined.Check, contentDescription = "Done")
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
            when {
                !state.hasPermission -> PermissionBlock(
                    onRequest = {
                        permissionLauncher.launch(Manifest.permission.READ_CONTACTS)
                    },
                )
                state.loading -> Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) { CircularProgressIndicator() }
                state.error != null -> Box(
                    modifier = Modifier.fillMaxSize().padding(24.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        state.error!!,
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
                else -> ContactsList(
                    contacts = state.contacts,
                    query = state.query,
                    selectedKeys = state.selectedKeys,
                    onQuery = vm::setQuery,
                    onToggle = vm::toggle,
                )
            }
        }
    }
}

@Composable
private fun PermissionBlock(onRequest: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(48.dp))
        Text(
            "Contacts permission needed",
            style = MaterialTheme.typography.titleLarge,
        )
        Text(
            "Allow access so you can pick recipients from your contacts.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Button(onClick = onRequest) { Text("Grant access") }
    }
}

@Composable
private fun ContactsList(
    contacts: List<PickedContact>,
    query: String,
    selectedKeys: Set<String>,
    onQuery: (String) -> Unit,
    onToggle: (PickedContact) -> Unit,
) {
    Column(modifier = Modifier.fillMaxSize()) {
        OutlinedTextField(
            value = query,
            onValueChange = onQuery,
            label = { Text("Search") },
            singleLine = true,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp),
        )
        HorizontalDivider()
        val rows = remember(contacts, query) { filterContacts(contacts, query) }
        if (rows.isEmpty()) {
            Box(
                modifier = Modifier.fillMaxSize().padding(24.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    if (contacts.isEmpty())
                        "No contacts found on this device."
                    else
                        "No matches for \u201C${query}\u201D.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            return@Column
        }
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(vertical = 4.dp),
        ) {
            items(rows, key = { it.selectionKey() }) { contact ->
                val key = contact.selectionKey()
                ContactRow(
                    contact = contact,
                    selected = key in selectedKeys,
                    onClick = { onToggle(contact) },
                )
            }
            item { Spacer(Modifier.height(72.dp)) }
        }
    }
}

@Composable
private fun ContactRow(
    contact: PickedContact,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Checkbox(checked = selected, onCheckedChange = { onClick() })
        Column(modifier = Modifier.weight(1f)) {
            Text(
                contact.displayName,
                style = MaterialTheme.typography.bodyLarge,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                contact.phoneNumber,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
