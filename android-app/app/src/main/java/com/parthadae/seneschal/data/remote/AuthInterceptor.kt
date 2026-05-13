package com.parthadae.seneschal.data.remote

import com.parthadae.seneschal.auth.AuthRepository
import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.Response
import javax.inject.Inject
import javax.inject.Singleton

/**
 * OkHttp interceptor that attaches the user's Firebase ID token as a
 * Bearer header. We block the calling thread because OkHttp is sync; the
 * token fetch is fast (in-memory cache) unless a refresh is needed.
 *
 * On 401 we transparently retry once with a force-refreshed token, which
 * handles the race where the cached token expired between issuance and
 * arrival at the server.
 */
@Singleton
class AuthInterceptor @Inject constructor(
    private val authRepository: AuthRepository,
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()
        val token = runBlocking { authRepository.currentIdToken() }
            ?: return chain.proceed(original)

        val firstAttempt = chain.proceed(
            original.newBuilder()
                .header("Authorization", "Bearer $token")
                .build()
        )
        if (firstAttempt.code != 401) return firstAttempt

        firstAttempt.close()
        val refreshed = runBlocking { authRepository.currentIdToken(forceRefresh = true) }
            ?: return chain.proceed(original)
        return chain.proceed(
            original.newBuilder()
                .header("Authorization", "Bearer $refreshed")
                .build()
        )
    }
}
