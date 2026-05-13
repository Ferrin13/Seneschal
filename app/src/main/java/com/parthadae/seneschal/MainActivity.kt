package com.parthadae.seneschal

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import com.parthadae.seneschal.ui.SeneschalRoot
import com.parthadae.seneschal.ui.theme.SeneschalTheme
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            SeneschalTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    SeneschalRoot()
                }
            }
        }
    }
}
