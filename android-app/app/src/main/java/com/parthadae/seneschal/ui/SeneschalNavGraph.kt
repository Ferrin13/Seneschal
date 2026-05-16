package com.parthadae.seneschal.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
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
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.parthadae.seneschal.ui.activities.ActivitiesScreen
import com.parthadae.seneschal.ui.expenses.ExpenseTrackingFlow
import com.parthadae.seneschal.ui.home.HomeScreen
import com.parthadae.seneschal.ui.home.PlaceholderFeatureScreen
import com.parthadae.seneschal.ui.settings.SettingsScreen
import com.parthadae.seneschal.ui.stats.StatsScreen
import com.parthadae.seneschal.ui.today.TodayScreen

private object RootRoutes {
    const val HOME = "home"
    const val TIME = "time"
    const val EXPENSES = "expenses"
    const val GROUP_TEXT = "group_text"
    const val CLIPBOARD = "clipboard"
    const val SETTINGS = "settings"
}

private enum class TimeTab(val route: String, val label: String, val icon: ImageVector) {
    Today("today", "Today", Icons.Outlined.CalendarToday),
    Stats("stats", "Stats", Icons.Outlined.BarChart),
    Activities("activities", "Activities", Icons.Outlined.Category),
    Settings("settings", "Settings", Icons.Outlined.Settings),
}

@Composable
fun SeneschalNavGraph() {
    val navController = rememberNavController()
    NavHost(
        navController = navController,
        startDestination = RootRoutes.HOME,
    ) {
        composable(RootRoutes.HOME) {
            HomeScreen(
                onTimeTracking = {
                    navController.navigate(RootRoutes.TIME) {
                        launchSingleTop = true
                    }
                },
                onExpenseTracking = {
                    navController.navigate(RootRoutes.EXPENSES) { launchSingleTop = true }
                },
                onGroupTexting = {
                    navController.navigate(RootRoutes.GROUP_TEXT) { launchSingleTop = true }
                },
                onClipboard = {
                    navController.navigate(RootRoutes.CLIPBOARD) { launchSingleTop = true }
                },
                onSettings = {
                    navController.navigate(RootRoutes.SETTINGS) { launchSingleTop = true }
                },
            )
        }
        composable(RootRoutes.TIME) {
            TimeTrackingFlow(
                onNavigateHome = {
                    navController.popBackStack()
                },
            )
        }
        composable(RootRoutes.EXPENSES) {
            ExpenseTrackingFlow(onNavigateHome = { navController.popBackStack() })
        }
        composable(RootRoutes.GROUP_TEXT) {
            PlaceholderFeatureScreen(
                title = "Group texting",
                description = "Group texting is not available yet. This screen will appear in a future update.",
                onBack = { navController.popBackStack() },
            )
        }
        composable(RootRoutes.CLIPBOARD) {
            PlaceholderFeatureScreen(
                title = "Clipboard",
                description = "Clipboard tools are not available yet. This screen will appear in a future update.",
                onBack = { navController.popBackStack() },
            )
        }
        composable(RootRoutes.SETTINGS) {
            SettingsScreen(onNavigateHome = { navController.popBackStack() })
        }
    }
}

@Composable
private fun TimeTrackingFlow(
    onNavigateHome: () -> Unit,
) {
    val innerNav = rememberNavController()
    val backStackEntry by innerNav.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route

    BackHandler {
        if (!innerNav.popBackStack()) {
            onNavigateHome()
        }
    }

    Scaffold(
        bottomBar = {
            NavigationBar {
                TimeTab.entries.forEach { tab ->
                    NavigationBarItem(
                        selected = currentRoute == tab.route,
                        onClick = {
                            innerNav.navigate(tab.route) {
                                popUpTo(innerNav.graph.findStartDestination().id) {
                                    saveState = true
                                }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        icon = { Icon(tab.icon, contentDescription = tab.label) },
                        label = { Text(tab.label) },
                    )
                }
            }
        },
    ) { padding: PaddingValues ->
        NavHost(
            navController = innerNav,
            startDestination = TimeTab.Today.route,
            modifier = Modifier.padding(padding),
        ) {
            composable(TimeTab.Today.route) {
                TodayScreen(onNavigateHome = onNavigateHome)
            }
            composable(TimeTab.Stats.route) {
                StatsScreen(onNavigateHome = onNavigateHome)
            }
            composable(TimeTab.Activities.route) {
                ActivitiesScreen(onNavigateHome = onNavigateHome)
            }
            composable(TimeTab.Settings.route) {
                SettingsScreen(
                    onNavigateHome = onNavigateHome,
                    topAppBarWindowInsets = WindowInsets(0, 0, 0, 0),
                )
            }
        }
    }
}
