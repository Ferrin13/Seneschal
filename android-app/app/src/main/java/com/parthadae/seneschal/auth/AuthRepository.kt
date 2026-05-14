package com.parthadae.seneschal.auth

import android.content.Context
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import com.parthadae.seneschal.BuildConfig
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.GoogleAuthProvider
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Wraps Firebase Auth + Credential Manager so the rest of the app sees a
 * simple Flow of `AuthState` and a couple of suspend operations. The actual
 * UI surfaces (sign-in screen, settings) call into here.
 */
@Singleton
class AuthRepository @Inject constructor(
    @ApplicationContext private val appContext: Context,
    private val firebaseAuth: FirebaseAuth,
) {
    companion object {
        // Single-tenant allowlist. Backend enforces the same; this client-side
        // check just gives a friendlier error before any API call is made.
        private const val ALLOWED_EMAIL = "12aplustech@gmail.com"
    }

    val authState: Flow<AuthState> = callbackFlow {
        val listener = FirebaseAuth.AuthStateListener { auth ->
            val user = auth.currentUser
            trySend(
                if (user == null) AuthState.SignedOut
                else AuthState.SignedIn(
                    uid = user.uid,
                    email = user.email,
                    displayName = user.displayName,
                )
            )
        }
        firebaseAuth.addAuthStateListener(listener)
        awaitClose { firebaseAuth.removeAuthStateListener(listener) }
    }

    fun currentUid(): String? = firebaseAuth.currentUser?.uid

    /**
     * Always returns a fresh Firebase ID token (auto-refreshes if expired).
     * Returns null when no one is signed in.
     */
    suspend fun currentIdToken(forceRefresh: Boolean = false): String? {
        val user = firebaseAuth.currentUser ?: return null
        return user.getIdToken(forceRefresh).await().token
    }

    /**
     * Triggers Sign in with Google via the Credential Manager API. Caller
     * supplies an Activity context (Credential Manager needs it to render
     * the bottom sheet).
     */
    suspend fun signInWithGoogle(activityContext: Context) {
        val webClientId = BuildConfig.GOOGLE_WEB_CLIENT_ID
        check(webClientId.isNotBlank()) {
            "GOOGLE_WEB_CLIENT_ID not set in local.properties (seneschal.googleWebClientId=...)"
        }
        val credentialManager = CredentialManager.create(activityContext)
        val googleIdOption = GetGoogleIdOption.Builder()
            .setServerClientId(webClientId)
            .setFilterByAuthorizedAccounts(false)
            .setAutoSelectEnabled(true)
            .build()
        val request = GetCredentialRequest.Builder()
            .addCredentialOption(googleIdOption)
            .build()
        val response = credentialManager.getCredential(activityContext, request)
        val credential = response.credential
        if (credential is CustomCredential &&
            credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
        ) {
            val googleCred = GoogleIdTokenCredential.createFrom(credential.data)
            val email = googleCred.id
            if (!email.equals(ALLOWED_EMAIL, ignoreCase = true)) {
                // Don't even hand the token to Firebase if we already know it
                // will be rejected by the backend. Clear any cached credential
                // so the next attempt prompts for an account again.
                runCatching {
                    CredentialManager.create(appContext)
                        .clearCredentialState(ClearCredentialStateRequest())
                }
                error("This Seneschal instance is restricted to $ALLOWED_EMAIL. You signed in as $email.")
            }
            val firebaseCred = GoogleAuthProvider.getCredential(googleCred.idToken, null)
            firebaseAuth.signInWithCredential(firebaseCred).await()
        } else {
            error("Unexpected credential type: ${credential.type}")
        }
    }

    suspend fun signOut() {
        firebaseAuth.signOut()
        runCatching {
            CredentialManager.create(appContext)
                .clearCredentialState(ClearCredentialStateRequest())
        }
    }
}

sealed interface AuthState {
    data object SignedOut : AuthState
    data class SignedIn(
        val uid: String,
        val email: String?,
        val displayName: String?,
    ) : AuthState
}
