package com.parthadae.seneschal.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.parthadae.seneschal.auth.AuthState
import com.parthadae.seneschal.ui.signin.SignInScreen

/**
 * Top-level composable wired in by [com.parthadae.seneschal.MainActivity].
 * Switches between the sign-in screen, the in-app nav graph, and an initial
 * loading state while [RootViewModel] is waiting for the first auth emission.
 *
 * Lives in this package (not `com.parthadae.seneschal`) so its name cannot
 * collide with the `SeneschalApp` Application class.
 */
@Composable
fun SeneschalRoot(rootVm: RootViewModel = hiltViewModel()) {
    val state by rootVm.authState.collectAsStateWithLifecycle()
    when (state) {
        AuthState.SignedOut -> SignInScreen()
        is AuthState.SignedIn -> SeneschalNavGraph()
        null -> LoadingScreen()
    }
}

@Composable
private fun LoadingScreen() {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator()
    }
}
