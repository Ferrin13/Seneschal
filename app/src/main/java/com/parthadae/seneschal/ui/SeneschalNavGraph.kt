package com.parthadae.seneschal.ui

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.CalendarToday
import androidx.compose.material.icons.outlined.Category
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.parthadae.seneschal.ui.activities.ActivitiesScreen
import com.parthadae.seneschal.ui.settings.SettingsScreen
import com.parthadae.seneschal.ui.stats.StatsScreen
import com.parthadae.seneschal.ui.today.TodayScreen

private enum class TopDest(val route: String, val label: String, val icon: ImageVector) {
    Today("today", "Today", Icons.Outlined.CalendarToday),
    Stats("stats", "Stats", Icons.Outlined.BarChart),
    Activities("activities", "Activities", Icons.Outlined.Category),
    Settings("settings", "Settings", Icons.Outlined.Settings),
}

@Composable
fun SeneschalNavGraph() {
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route

    Scaffold(
        bottomBar = {
            NavigationBar {
                TopDest.entries.forEach { dest ->
                    NavigationBarItem(
                        selected = currentRoute == dest.route,
                        onClick = {
                            navController.navigate(dest.route) {
                                popUpTo(navController.graph.findStartDestination().id) {
                                    saveState = true
                                }
                                launchSingleTop = true
                                restoreState = true
                            }
                            // Keep referenced
                            backStackEntry?.destination?.hierarchy
                        },
                        icon = { Icon(dest.icon, contentDescription = dest.label) },
                        label = { Text(dest.label) },
                    )
                }
            }
        }
    ) { padding: PaddingValues ->
        NavHost(
            navController = navController,
            startDestination = TopDest.Today.route,
            modifier = Modifier.padding(padding),
        ) {
            composable(TopDest.Today.route) { TodayScreen() }
            composable(TopDest.Stats.route) { StatsScreen() }
            composable(TopDest.Activities.route) { ActivitiesScreen() }
            composable(TopDest.Settings.route) { SettingsScreen() }
        }
    }
}
