package com.parthadae.seneschal.ui.grouptext

import javax.inject.Inject
import javax.inject.Singleton

/**
 * One in-flight send queued from the [SendScreen] for the [SendQueueScreen]
 * to drain. Held in a process-singleton because the recipient list isn't
 * cheap to serialize through nav arguments and the queue screen runs in
 * the same process anyway. The holder is reset to null after the queue
 * starts consuming it.
 */
data class PendingSend(
    val body: String,
    val recipients: List<SendRecipient>,
)

data class SendRecipient(
    val displayName: String,
    val phoneNumber: String,
)

@Singleton
class PendingSendHolder @Inject constructor() {
    @Volatile
    private var pending: PendingSend? = null

    fun put(send: PendingSend) {
        pending = send
    }

    /** One-shot read; returns null if there's nothing queued or if it has already been consumed. */
    fun consume(): PendingSend? {
        val v = pending
        pending = null
        return v
    }
}
