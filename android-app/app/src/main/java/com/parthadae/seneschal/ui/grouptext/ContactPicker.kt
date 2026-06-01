package com.parthadae.seneschal.ui.grouptext

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.ContactsContract
import androidx.activity.result.contract.ActivityResultContract
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * One contact pulled out of the system contact picker. We snapshot the
 * display name + phone number into our own group_members table rather
 * than holding onto the URI, so messaging keeps working even if the user
 * later revokes contacts permission or the underlying contact changes.
 */
data class PickedContact(
    val displayName: String,
    val phoneNumber: String,
    val contactLookupKey: String?,
)

/**
 * Custom picker contract that asks for a *phone* row directly instead of
 * a contact row. The system picker shows numbers inline and, for contacts
 * with multiple numbers, lets the user choose which one to send to. The
 * returned URI is a `data` row (mime-type `vnd.android.cursor.item/phone_v2`)
 * so the columns `DISPLAY_NAME`, `NUMBER`, and `LOOKUP_KEY` resolve
 * without needing `READ_CONTACTS` permission.
 *
 * The default `ActivityResultContracts.PickContact()` instead returns a
 * URI to the parent Contacts row, which has no `data1` column — querying
 * for `Phone.NUMBER` on that URI throws "Invalid column data1".
 */
class PickPhoneContact : ActivityResultContract<Unit, Uri?>() {
    override fun createIntent(context: Context, input: Unit): Intent =
        Intent(Intent.ACTION_PICK, ContactsContract.CommonDataKinds.Phone.CONTENT_URI)

    override fun parseResult(resultCode: Int, intent: Intent?): Uri? =
        if (resultCode == Activity.RESULT_OK) intent?.data else null
}

/**
 * Resolve a picker-result URI into a [PickedContact]. Handles both:
 *
 * - The phone-row URI returned by [PickPhoneContact] (the happy path).
 * - The contact-row URI returned by `ActivityResultContracts.PickContact()`
 *   on devices/launchers that hand back the parent Contacts row instead.
 *   In that case we follow the contact's `_ID` over to the Phone table
 *   and grab the first number.
 *
 * Returns null if no usable phone number could be extracted.
 */
fun resolvePickedContact(context: Context, uri: Uri): PickedContact? {
    val resolver = context.contentResolver

    // First try treating the URI as a phone-data row.
    runCatching {
        val projection = arrayOf(
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Phone.NUMBER,
            ContactsContract.CommonDataKinds.Phone.LOOKUP_KEY,
        )
        resolver.query(uri, projection, null, null, null)?.use { c ->
            if (c.moveToFirst()) {
                val number = c.getStringOrEmpty(1)
                if (number.isNotBlank()) {
                    val displayName = c.getStringOrEmpty(0)
                    return PickedContact(
                        displayName = displayName.ifBlank { number },
                        phoneNumber = number,
                        contactLookupKey = c.getStringOrNull(2),
                    )
                }
            }
        }
    }

    // Fall through: the URI is a Contacts row, not a phone-data row.
    // Pull the contact's `_ID` and look up its numbers separately.
    val contactId: Long? = runCatching {
        resolver.query(
            uri,
            arrayOf(ContactsContract.Contacts._ID, ContactsContract.Contacts.DISPLAY_NAME),
            null,
            null,
            null,
        )?.use { c ->
            if (c.moveToFirst()) c.getLong(0) else null
        }
    }.getOrNull()
        ?: return null

    return resolver.query(
        ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
        arrayOf(
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Phone.NUMBER,
            ContactsContract.CommonDataKinds.Phone.LOOKUP_KEY,
        ),
        "${ContactsContract.CommonDataKinds.Phone.CONTACT_ID} = ?",
        arrayOf(contactId.toString()),
        null,
    )?.use { c ->
        if (!c.moveToFirst()) return@use null
        val number = c.getStringOrEmpty(1)
        if (number.isBlank()) return@use null
        val displayName = c.getStringOrEmpty(0)
        PickedContact(
            displayName = displayName.ifBlank { number },
            phoneNumber = number,
            contactLookupKey = c.getStringOrNull(2),
        )
    }
}

private fun android.database.Cursor.getStringOrEmpty(index: Int): String =
    if (isNull(index)) "" else getString(index) ?: ""

private fun android.database.Cursor.getStringOrNull(index: Int): String? =
    if (isNull(index)) null else getString(index)

/**
 * Load every phone-data row visible to the app. Returns one entry per
 * phone number — a contact with two numbers shows up twice so the user
 * can pick a specific one in a multi-select UI. Requires `READ_CONTACTS`
 * to have been granted; the caller is responsible for that check.
 */
fun loadAllPhoneContacts(context: Context): List<PickedContact> {
    val resolver = context.contentResolver
    val projection = arrayOf(
        ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
        ContactsContract.CommonDataKinds.Phone.NUMBER,
        ContactsContract.CommonDataKinds.Phone.LOOKUP_KEY,
    )
    val sortOrder =
        "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} COLLATE NOCASE ASC"
    val out = mutableListOf<PickedContact>()
    resolver.query(
        ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
        projection,
        null,
        null,
        sortOrder,
    )?.use { c ->
        while (c.moveToNext()) {
            val number = c.getStringOrEmpty(1)
            if (number.isBlank()) continue
            val displayName = c.getStringOrEmpty(0)
            out += PickedContact(
                displayName = displayName.ifBlank { number },
                phoneNumber = number,
                contactLookupKey = c.getStringOrNull(2),
            )
        }
    }
    // De-dupe identical (name + normalized-number) pairs that some contact
    // providers return more than once (e.g. when the same number is on
    // multiple raw contacts that got auto-merged).
    return out.distinctBy { it.displayName to it.phoneNumber.filter { ch -> !ch.isWhitespace() } }
}

/**
 * Hand-off between the multi-select [ContactsPickerScreen] and whichever
 * screen launched it (a [GroupEditScreen] or [SendScreen]). Mirrors the
 * [PendingSendHolder] pattern: the picker writes a non-null list on
 * confirm, the consumer reads-then-clears via [consume].
 */
@Singleton
class PickedContactsHolder @Inject constructor() {
    private val _picked = MutableStateFlow<List<PickedContact>?>(null)
    val picked: StateFlow<List<PickedContact>?> = _picked.asStateFlow()

    fun put(contacts: List<PickedContact>) {
        _picked.value = contacts
    }

    /** One-shot read; returns null if nothing is waiting. */
    fun consume(): List<PickedContact>? {
        val v = _picked.value
        _picked.value = null
        return v
    }
}
