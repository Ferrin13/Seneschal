package com.parthadae.seneschal.di

import com.parthadae.seneschal.BuildConfig
import com.parthadae.seneschal.data.remote.AuthInterceptor
import com.parthadae.seneschal.data.remote.SeneschalApi
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory
import java.util.concurrent.TimeUnit
import javax.inject.Named
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {
    @Provides
    @Singleton
    fun moshi(): Moshi = Moshi.Builder()
        .add(KotlinJsonAdapterFactory())
        .build()

    @Provides
    @Singleton
    fun okHttpClient(authInterceptor: AuthInterceptor): OkHttpClient {
        val builder = OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .addInterceptor(authInterceptor)
        if (BuildConfig.DEBUG) {
            builder.addInterceptor(
                HttpLoggingInterceptor().apply {
                    level = HttpLoggingInterceptor.Level.BASIC
                }
            )
        }
        return builder.build()
    }

    @Provides
    @Singleton
    fun retrofit(client: OkHttpClient, moshi: Moshi): Retrofit =
        Retrofit.Builder()
            .baseUrl(BuildConfig.API_BASE_URL)
            .client(client)
            .addConverterFactory(MoshiConverterFactory.create(moshi))
            .build()

    @Provides
    @Singleton
    fun seneschalApi(retrofit: Retrofit): SeneschalApi =
        retrofit.create(SeneschalApi::class.java)

    /**
     * Plain OkHttpClient with no auth interceptor, used for direct uploads
     * to S3 via presigned URLs. Adding `Authorization: Bearer <id token>`
     * to those requests would invalidate the signature.
     *
     * In debug builds we attach a HEADERS-level logging interceptor so that
     * presigned-URL failures (SignatureDoesNotMatch / AccessDenied) can be
     * diagnosed by comparing the actual request line + headers we send
     * against the canonical request S3 echoes back in its 403 body. Bytes
     * are deliberately NOT logged: image uploads can be many MB and we
     * never want them in logcat.
     */
    @Provides
    @Singleton
    @Named("uploadClient")
    fun uploadOkHttpClient(): OkHttpClient {
        val builder = OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(120, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
        if (BuildConfig.DEBUG) {
            builder.addInterceptor(
                HttpLoggingInterceptor().apply {
                    level = HttpLoggingInterceptor.Level.HEADERS
                }
            )
        }
        return builder.build()
    }
}
