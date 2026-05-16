package com.parthadae.seneschal.data.remote

import com.parthadae.seneschal.data.remote.dto.ActivityCreateRequest
import com.parthadae.seneschal.data.remote.dto.ActivityDto
import com.parthadae.seneschal.data.remote.dto.ActivityPatchRequest
import com.parthadae.seneschal.data.remote.dto.BusinessDto
import com.parthadae.seneschal.data.remote.dto.CategoryCreateRequest
import com.parthadae.seneschal.data.remote.dto.CategoryDto
import com.parthadae.seneschal.data.remote.dto.CategoryPatchRequest
import com.parthadae.seneschal.data.remote.dto.ExpenseDto
import com.parthadae.seneschal.data.remote.dto.ExpensesUpsertRequest
import com.parthadae.seneschal.data.remote.dto.MeDto
import com.parthadae.seneschal.data.remote.dto.PresignedDownloadResponse
import com.parthadae.seneschal.data.remote.dto.PresignedUploadRequest
import com.parthadae.seneschal.data.remote.dto.PresignedUploadResponse
import com.parthadae.seneschal.data.remote.dto.SlotsUpsertRequest
import com.parthadae.seneschal.data.remote.dto.TimeSlotDto
import com.parthadae.seneschal.data.remote.dto.TimerDto
import com.parthadae.seneschal.data.remote.dto.TimerStartRequest
import com.parthadae.seneschal.data.remote.dto.TimerStopRequest
import com.parthadae.seneschal.data.remote.dto.TimerStopResponse
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query

interface SeneschalApi {
    @GET("me")
    suspend fun getMe(): MeDto

    @GET("categories")
    suspend fun getCategories(
        @Query("since") since: String? = null,
        @Query("includeDeleted") includeDeleted: Boolean? = null,
    ): List<CategoryDto>

    @POST("categories")
    suspend fun createCategory(@Body body: CategoryCreateRequest): CategoryDto

    @PATCH("categories/{id}")
    suspend fun patchCategory(
        @Path("id") id: String,
        @Body body: CategoryPatchRequest,
    ): CategoryDto

    @DELETE("categories/{id}")
    suspend fun deleteCategory(@Path("id") id: String): Response<Unit>

    @GET("activities")
    suspend fun getActivities(
        @Query("since") since: String? = null,
        @Query("includeDeleted") includeDeleted: Boolean? = null,
    ): List<ActivityDto>

    @POST("activities")
    suspend fun createActivity(@Body body: ActivityCreateRequest): ActivityDto

    @PATCH("activities/{id}")
    suspend fun patchActivity(
        @Path("id") id: String,
        @Body body: ActivityPatchRequest,
    ): ActivityDto

    @DELETE("activities/{id}")
    suspend fun deleteActivity(@Path("id") id: String): Response<Unit>

    @GET("slots")
    suspend fun getSlots(
        @Query("from") from: String? = null,
        @Query("to") to: String? = null,
        @Query("since") since: String? = null,
    ): List<TimeSlotDto>

    @PUT("slots")
    suspend fun upsertSlots(@Body body: SlotsUpsertRequest): List<TimeSlotDto>

    @GET("timer")
    suspend fun getTimer(): Response<TimerDto>

    @POST("timer/start")
    suspend fun startTimer(@Body body: TimerStartRequest): TimerDto

    @POST("timer/stop")
    suspend fun stopTimer(@Body body: TimerStopRequest): Response<TimerStopResponse>

    @GET("businesses")
    suspend fun getBusinesses(
        @Query("since") since: String? = null,
        @Query("includeDeleted") includeDeleted: Boolean? = null,
    ): List<BusinessDto>

    @GET("expenses")
    suspend fun getExpenses(
        @Query("from") from: String? = null,
        @Query("to") to: String? = null,
        @Query("since") since: String? = null,
    ): List<ExpenseDto>

    @PUT("expenses")
    suspend fun upsertExpenses(@Body body: ExpensesUpsertRequest): List<ExpenseDto>

    @POST("uploads/sign")
    suspend fun signUpload(@Body body: PresignedUploadRequest): PresignedUploadResponse

    @GET("uploads/sign")
    suspend fun signDownload(@Query("key") key: String): PresignedDownloadResponse
}
