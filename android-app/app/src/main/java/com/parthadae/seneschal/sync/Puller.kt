package com.parthadae.seneschal.sync

/**
 * Pluggable read-side worker that pulls a slice of server state into Room.
 * SyncWorker invokes every bound puller after the outbox has drained, so
 * pulls always see the freshest state the client just pushed.
 *
 * Throw to abort the sync — WorkManager will retry the whole worker.
 */
interface Puller {
    suspend fun pull()
}
