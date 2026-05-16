package com.parthadae.seneschal.data.repository

import android.content.Context
import android.net.Uri
import com.parthadae.seneschal.data.local.PendingMutationDao
import com.parthadae.seneschal.data.local.PendingMutationEntity
import com.parthadae.seneschal.data.remote.SeneschalApi
import com.parthadae.seneschal.data.remote.dto.ImageUploadDto
import com.parthadae.seneschal.sync.SyncScheduler
import com.squareup.moshi.Moshi
import com.squareup.moshi.adapter
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Result of copying a picked image into our own filesDir. The caller stores
 * [localPath] on the owning row so the UI can render the image immediately,
 * then hands the same path to [ImageRepository.enqueueUpload] so the sync
 * worker eventually ships the bytes to S3.
 */
data class LocalImageHandle(
    val localPath: String,
    val contentType: String,
    val sizeBytes: Long,
)

/**
 * Generic, feature-agnostic image plumbing. Today this is used by the
 * expense tracker; any future feature that wants to attach an image just
 * calls [attachImage] + [enqueueUpload] and registers an
 * [com.parthadae.seneschal.sync.ImageAttacher] for its `ownerKind`.
 *
 * Bytes are cached under `filesDir/images/<uuid>.<ext>` until upload
 * succeeds, so the file survives process death and lets the user see the
 * image they just attached even before sync completes.
 */
@OptIn(ExperimentalStdlibApi::class)
@Singleton
class ImageRepository @Inject constructor(
    @ApplicationContext private val context: Context,
    private val pendingMutationDao: PendingMutationDao,
    private val syncScheduler: SyncScheduler,
    private val api: SeneschalApi,
    moshi: Moshi,
) {
    private val uploadAdapter = moshi.adapter<ImageUploadDto>()

    private val imagesDir: File by lazy {
        File(context.filesDir, "images").apply { mkdirs() }
    }

    /**
     * Copy the bytes referenced by [uri] into our own filesDir and return
     * a stable handle. The original (gallery URI / camera capture) may
     * become unreadable after the activity that produced it dies, so we
     * never reference it directly from the outbox.
     */
    suspend fun attachImage(uri: Uri): LocalImageHandle = withContext(Dispatchers.IO) {
        val resolver = context.contentResolver
        val contentType = resolver.getType(uri) ?: "application/octet-stream"
        val ext = extensionFor(contentType)
        val file = File(imagesDir, "${UUID.randomUUID()}.$ext")
        resolver.openInputStream(uri).use { input ->
            if (input == null) throw IOException("Could not open URI: $uri")
            file.outputStream().use { output -> input.copyTo(output) }
        }
        LocalImageHandle(
            localPath = file.absolutePath,
            contentType = contentType,
            sizeBytes = file.length(),
        )
    }

    /**
     * Enqueue a deferred upload of [handle] to S3. After the upload succeeds
     * the matching [com.parthadae.seneschal.sync.ImageAttacher] (selected by
     * [ownerKind]) is invoked with the resolved object key.
     */
    suspend fun enqueueUpload(
        handle: LocalImageHandle,
        ownerKind: String,
        ownerId: String,
        purpose: String,
    ) {
        val dto = ImageUploadDto(
            localPath = handle.localPath,
            contentType = handle.contentType,
            sizeBytes = handle.sizeBytes,
            ownerKind = ownerKind,
            ownerId = ownerId,
            purpose = purpose,
        )
        pendingMutationDao.insert(
            PendingMutationEntity(
                kind = KIND_IMAGE_UPLOAD,
                targetId = ownerId,
                payloadJson = uploadAdapter.toJson(dto),
                createdAt = System.currentTimeMillis(),
            )
        )
        syncScheduler.requestImmediateSync()
    }

    /**
     * One-shot resolution of an S3 key to a short-lived presigned GET URL
     * the UI can hand to Coil. Cached for the duration of one resolution
     * roundtrip; callers can implement their own longer-lived caching if
     * needed.
     */
    suspend fun presignedDisplayUrl(imageKey: String): String =
        api.signDownload(imageKey).url

    /** Best-effort cleanup of a cached local file. */
    fun deleteLocal(path: String) {
        runCatching { File(path).delete() }
    }

    companion object {
        const val KIND_IMAGE_UPLOAD = "image_upload"

        private fun extensionFor(contentType: String): String = when (contentType) {
            "image/jpeg" -> "jpg"
            "image/png" -> "png"
            "image/webp" -> "webp"
            else -> "bin"
        }
    }
}
