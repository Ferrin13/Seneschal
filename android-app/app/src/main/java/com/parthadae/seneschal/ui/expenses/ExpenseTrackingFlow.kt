package com.parthadae.seneschal.ui.expenses

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ReceiptLong
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Storefront
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
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.parthadae.seneschal.ui.settings.SettingsScreen

private enum class ExpenseTab(val route: String, val label: String, val icon: ImageVector) {
    Expenses("list", "Expenses", Icons.AutoMirrored.Outlined.ReceiptLong),
    Businesses("businesses", "Businesses", Icons.Outlined.Storefront),
    Settings("settings", "Settings", Icons.Outlined.Settings),
}

private object ExpenseRoutes {
    /** Edit/create. Nullable id arg: null = new. */
    const val EDIT = "edit"
    const val EDIT_WITH_ARG = "edit?expenseId={expenseId}"
    fun edit(id: String?) = if (id == null) EDIT else "edit?expenseId=$id"
}

@Composable
fun ExpenseTrackingFlow(onNavigateHome: () -> Unit) {
    val innerNav = rememberNavController()
    val backStackEntry by innerNav.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route

    BackHandler {
        if (!innerNav.popBackStack()) onNavigateHome()
    }

    val isTabRoute = currentRoute != null && ExpenseTab.entries.any { it.route == currentRoute }

    Scaffold(
        bottomBar = {
            // Edit screens are pushed routes, not tabs; hide the bottom bar
            // there so the form has more vertical room.
            if (isTabRoute) BottomBar(currentRoute, innerNav)
        },
    ) { padding: PaddingValues ->
        NavHost(
            navController = innerNav,
            startDestination = ExpenseTab.Expenses.route,
            modifier = Modifier.padding(padding),
        ) {
            composable(ExpenseTab.Expenses.route) {
                ExpensesListScreen(
                    onAdd = { innerNav.navigate(ExpenseRoutes.edit(null)) },
                    onEdit = { id -> innerNav.navigate(ExpenseRoutes.edit(id)) },
                    onSettings = { innerNav.navigate(ExpenseTab.Settings.route) },
                    onNavigateHome = onNavigateHome,
                )
            }
            composable(ExpenseTab.Businesses.route) {
                BusinessesScreen(onNavigateHome = onNavigateHome)
            }
            composable(ExpenseTab.Settings.route) {
                SettingsScreen(
                    onNavigateHome = onNavigateHome,
                    topAppBarWindowInsets = WindowInsets(0, 0, 0, 0),
                )
            }
            composable(
                route = ExpenseRoutes.EDIT_WITH_ARG,
                arguments = listOf(
                    navArgument("expenseId") {
                        type = NavType.StringType
                        nullable = true
                        defaultValue = null
                    }
                ),
            ) {
                ExpenseEditScreen(onBack = { innerNav.popBackStack() })
            }
        }
    }
}

@Composable
private fun BottomBar(currentRoute: String?, innerNav: androidx.navigation.NavController) {
    NavigationBar {
        ExpenseTab.entries.forEach { tab ->
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
}
