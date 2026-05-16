package com.parthadae.seneschal.data.remote

import android.util.Log
import okhttp3.Interceptor
import okhttp3.Response
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Logs the body of any non-2xx response coming back from the API. Runs in
 * both debug and release builds because the most useful failures (e.g. a
 * 503 from `/uploads/sign` whose body is `{"message":"s3_not_configured"}`)
 * are only diagnosable from prod logcat, and the alternative — `HttpException:
 * HTTP 503` with no body — is effectively a black box.
 *
 * The body is fully buffered (`peekBody`) and a fresh [Response] is returned
 * so downstream Retrofit error handling still sees the same bytes. A cap is
 * applied so a runaway error page can't blow logcat up. Successful 2xx
 * responses are passed through untouched so we never accidentally buffer
 * large list payloads.
 */
@Singleton
class HttpErrorLoggingInterceptor @Inject constructor() : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val response = chain.proceed(request)
        if (response.isSuccessful) return response

        val contentType = response.body?.contentType()
        val peeked = response.peekBody(MAX_BODY_BYTES).string()
        Log.w(
            TAG,
            "HTTP ${response.code} ${request.method} ${request.url.encodedPath} " +
                "respContentType=$contentType " +
                "body=${peeked.take(MAX_LOGGED_CHARS)}"
        )
        return response
    }

    companion object {
        private const val TAG = "ApiHttpError"
        private const val MAX_BODY_BYTES: Long = 64 * 1024
        private const val MAX_LOGGED_CHARS = 4000
    }
}
