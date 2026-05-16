package com.parthadae.seneschal.sync

/**
 * Each feature that owns image-bearing rows registers an [ImageAttacher]
 * with a unique [ownerKind]. After the image-upload outbox handler has
 * pushed bytes to S3 and learned the resolved object key, it dispatches
 * to the matching attacher to write that key back onto the owner row.
 *
 * Attachers are responsible for whatever follow-up sync work is needed
 * to propagate the key to the server (typically: enqueuing an upsert
 * mutation for their entity).
 */
interface ImageAttacher {
    val ownerKind: String

    /**
     * Persist [imageKey] onto the row identified by [ownerId]. Implementations
     * should silently no-op if the row no longer exists or has been
     * soft-deleted, so that a late upload doesn't resurrect a deleted row.
     */
    suspend fun attach(ownerId: String, imageKey: String)
}
