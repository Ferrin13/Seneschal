package com.parthadae.seneschal.sync

import android.util.Log
import com.parthadae.seneschal.data.local.PendingMutationDao
import com.parthadae.seneschal.data.local.PendingMutationEntity
import com.parthadae.seneschal.data.remote.SeneschalApi
import com.parthadae.seneschal.data.remote.dto.ImageUploadDto
import com.parthadae.seneschal.data.remote.dto.PresignedUploadRequest
import com.parthadae.seneschal.data.repository.ImageRepository
import com.squareup.moshi.Moshi
import com.squareup.moshi.adapter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import java.io.File
import java.io.IOException
import javax.inject.Inject
import javax.inject.Named
import javax.inject.Singleton

private const val TAG = "ImageUploadOutbox"
private const val MAX_LOGGED_ERROR_CHARS = 4000

/**
 * Per-row outbox handler that uploads queued image bytes to S3 and writes
 * the resolved object key back onto the owning row.
 *
 * Each row is processed independently:
 *
 * 1. Decode the [ImageUploadDto] payload.
 * 2. POST `/uploads/sign` to mint a short-lived presigned PUT URL.
 * 3. Stream the local file to S3 via a plain (un-authenticated) OkHttp
 *    client — the auth interceptor would corrupt the presigned signature.
 * 4. Dispatch to the registered [ImageAttacher] for the payload's
 *    `ownerKind` so the resolved key reaches its row (which typically
 *    enqueues a follow-up upsert).
 * 5. Delete the outbox row and best-effort delete the local cache file.
 *
 * If any step throws, the exception escapes; SyncWorker retries the whole
 * sync per WorkManager's backoff schedule. Rows that can't be parsed are
 * dropped immediately so a corrupt outbox can't block forever.
 */
@OptIn(ExperimentalStdlibApi::class)
@Singleton
class ImageUploadOutboxHandler @Inject constructor(
    private val api: SeneschalApi,
    private val pendingMutationDao: PendingMutationDao,
    @Named("uploadClient") private val uploadClient: OkHttpClient,
    attachers: Set<@JvmSuppressWildcards ImageAttacher>,
    moshi: Moshi,
) : OutboxHandler {
    private val adapter = moshi.adapter<ImageUploadDto>()
    private val attachersByKind: Map<String, ImageAttacher> =
        attachers.associateBy { it.ownerKind }

    override val kind: String = ImageRepository.KIND_IMAGE_UPLOAD

    override suspend fun push(rows: List<PendingMutationEntity>) {
        for (row in rows) {
            val payload = runCatching { adapter.fromJson(row.payloadJson) }.getOrNull()
            if (payload == null) {
                pendingMutationDao.delete(row.id)
                continue
            }
            uploadOne(payload)
            pendingMutationDao.delete(row.id)
        }
    }

    private suspend fun uploadOne(payload: ImageUploadDto) {
        val file = File(payload.localPath)
        if (!file.exists()) {
            // The cached bytes were wiped (e.g. user cleared app data).
            // Nothing we can do — drop silently so this doesn't block forever.
            return
        }

        val signed = api.signUpload(
            PresignedUploadRequest(
                purpose = payload.purpose,
                contentType = payload.contentType,
                contentLength = file.length(),
            )
        )

        withContext(Dispatchers.IO) {
            val mediaType = payload.contentType.toMediaType()
            val requestBody = file.asRequestBody(mediaType)
            val builder = Request.Builder()
                .url(signed.url)
                .put(requestBody)
            for ((k, v) in signed.headers) builder.header(k, v)
            val request = builder.build()
            uploadClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    // S3 returns the failure reason as an XML body (Code,
                    // Message, plus the StringToSign / CanonicalRequest it
                    // calculated for SignatureDoesNotMatch). Capturing it
                    // here is the only way to tell apart AccessDenied,
                    // SignatureDoesNotMatch, RequestTimeTooSkewed, etc. —
                    // each of which has a very different fix.
                    val errorBody = runCatching {
                        response.body?.string()?.take(MAX_LOGGED_ERROR_CHARS)
                    }.getOrNull().orEmpty()
                    val signedHeaderKeys = signed.headers.keys.joinToString(",")
                    val sentContentLength = requestBody.contentLength()
                    val urlHost = request.url.host
                    val urlPath = request.url.encodedPath
                    Log.w(
                        TAG,
                        "S3 PUT ${response.code} key=${signed.key} " +
                            "host=$urlHost path=$urlPath " +
                            "contentType=${payload.contentType} " +
                            "fileLen=${file.length()} bodyLen=$sentContentLength " +
                            "respContentType=${response.header("Content-Type")} " +
                            "amzRequestId=${response.header("x-amz-request-id")} " +
                            "amzId2=${response.header("x-amz-id-2")} " +
                            "signedRespHeaders=[$signedHeaderKeys] " +
                            "body=$errorBody"
                    )
                    throw IOException(
                        "S3 PUT failed (${response.code}) for ${signed.key}: $errorBody"
                    )
                }
            }
        }

        val attacher = attachersByKind[payload.ownerKind]
        attacher?.attach(payload.ownerId, signed.key)
        runCatching { file.delete() }
    }

    override fun describe(row: PendingMutationEntity, ctx: DescribeContext): String {
        val parsed = runCatching { adapter.fromJson(row.payloadJson) }.getOrNull()
            ?: return "Upload image (${row.targetId ?: "?"})"
        return "Upload image (${parsed.ownerKind})"
    }
}
