package com.parthadae.seneschal

import android.app.Application
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import com.parthadae.seneschal.auth.AuthRepository
import com.parthadae.seneschal.auth.AuthState
import com.parthadae.seneschal.sync.SyncScheduler
import dagger.hilt.android.HiltAndroidApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltAndroidApp
class SeneschalApp : Application(), Configuration.Provider {
    @Inject lateinit var workerFactory: HiltWorkerFactory
    @Inject lateinit var syncScheduler: SyncScheduler
    @Inject lateinit var authRepository: AuthRepository

    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setWorkerFactory(workerFactory)
            .build()

    override fun onCreate() {
        super.onCreate()
        syncScheduler.schedulePeriodic()

        // Periodic work doesn't fire on enqueue, so without this the very
        // first launch would sit empty for up to 15 minutes. Trigger an
        // immediate sync whenever auth becomes signed-in (initial sign-in
        // and every cold-start while signed in).
        appScope.launch {
            authRepository.authState
                .map { it is AuthState.SignedIn }
                .distinctUntilChanged()
                .collect { signedIn ->
                    if (signedIn) syncScheduler.requestImmediateSync()
                }
        }
    }
}
