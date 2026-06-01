package com.parthadae.seneschal.sync

/**
 * Pluggable read-side worker that pulls a slice of server state into Room.
 * SyncWorker invokes every bound puller after the outbox has drained, so
 * pulls always see the freshest state the client just pushed.
 *
 * Throw to abort *this puller* — SyncWorker isolates failures per puller and
 * retries the whole worker later.
 */
interface Puller {
    /**
     * Relative run order; lower runs first. A puller whose rows carry a
     * foreign key to another table must run *after* the puller that fills
     * the parent table (e.g. expenses after businesses, group members after
     * groups), or the insert hits a FOREIGN KEY constraint on a fresh DB.
     */
    val order: Int get() = ORDER_DEFAULT

    suspend fun pull()

    companion object {
        /** Parent / independent tables. */
        const val ORDER_DEFAULT = 0

        /** Tables with a foreign key into a [ORDER_DEFAULT] table. */
        const val ORDER_DEPENDENT = 100
    }
}
