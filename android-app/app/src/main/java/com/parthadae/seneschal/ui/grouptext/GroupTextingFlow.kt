package com.parthadae.seneschal.ui.grouptext

import androidx.activity.compose.BackHandler
import androidx.compose.runtime.Composable
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument

private object GroupTextRoutes {
    const val HUB = "hub"

    const val TEMPLATE_LIST = "templates"
    const val TEMPLATE_EDIT = "template_edit"
    const val TEMPLATE_EDIT_WITH_ARG = "template_edit?templateId={templateId}"
    fun templateEdit(id: String?) =
        if (id == null) TEMPLATE_EDIT else "template_edit?templateId=$id"

    const val GROUP_LIST = "groups"
    const val GROUP_EDIT = "group_edit"
    const val GROUP_EDIT_WITH_ARG = "group_edit?groupId={groupId}"
    fun groupEdit(id: String?) =
        if (id == null) GROUP_EDIT else "group_edit?groupId=$id"

    const val SEND = "send"
    const val SEND_QUEUE = "send_queue"

    const val CONTACTS_PICKER = "contacts_picker"
}

/**
 * Internal NavHost for the group-texting feature. Mirrors the layout of
 * [com.parthadae.seneschal.ui.expenses.ExpenseTrackingFlow]: a hub plus
 * pushed editor / send screens.
 */
@Composable
fun GroupTextingFlow(onNavigateHome: () -> Unit) {
    val nav = rememberNavController()

    BackHandler {
        if (!nav.popBackStack()) onNavigateHome()
    }

    NavHost(navController = nav, startDestination = GroupTextRoutes.HUB) {
        composable(GroupTextRoutes.HUB) {
            GroupTextHubScreen(
                onTemplates = { nav.navigate(GroupTextRoutes.TEMPLATE_LIST) },
                onGroups = { nav.navigate(GroupTextRoutes.GROUP_LIST) },
                onNewSend = { nav.navigate(GroupTextRoutes.SEND) },
                onNavigateHome = onNavigateHome,
            )
        }

        composable(GroupTextRoutes.TEMPLATE_LIST) {
            TemplateListScreen(
                onAdd = { nav.navigate(GroupTextRoutes.templateEdit(null)) },
                onEdit = { id -> nav.navigate(GroupTextRoutes.templateEdit(id)) },
                onBack = { nav.popBackStack() },
            )
        }
        composable(
            route = GroupTextRoutes.TEMPLATE_EDIT_WITH_ARG,
            arguments = listOf(
                navArgument("templateId") {
                    type = NavType.StringType
                    nullable = true
                    defaultValue = null
                }
            ),
        ) {
            TemplateEditScreen(onBack = { nav.popBackStack() })
        }

        composable(GroupTextRoutes.GROUP_LIST) {
            GroupListScreen(
                onAdd = { nav.navigate(GroupTextRoutes.groupEdit(null)) },
                onEdit = { id -> nav.navigate(GroupTextRoutes.groupEdit(id)) },
                onBack = { nav.popBackStack() },
            )
        }
        composable(
            route = GroupTextRoutes.GROUP_EDIT_WITH_ARG,
            arguments = listOf(
                navArgument("groupId") {
                    type = NavType.StringType
                    nullable = true
                    defaultValue = null
                }
            ),
        ) {
            GroupEditScreen(
                onBack = { nav.popBackStack() },
                onPickContacts = { nav.navigate(GroupTextRoutes.CONTACTS_PICKER) },
            )
        }

        composable(GroupTextRoutes.SEND) {
            SendScreen(
                onBack = { nav.popBackStack() },
                onStartSending = {
                    nav.navigate(GroupTextRoutes.SEND_QUEUE)
                },
                onPickContacts = { nav.navigate(GroupTextRoutes.CONTACTS_PICKER) },
            )
        }

        composable(GroupTextRoutes.CONTACTS_PICKER) {
            ContactsPickerScreen(onBack = { nav.popBackStack() })
        }
        composable(GroupTextRoutes.SEND_QUEUE) {
            SendQueueScreen(
                onDone = {
                    // Pop back past both the queue and the setup screen so
                    // the user lands on the hub, ready to start another send.
                    nav.popBackStack(
                        route = GroupTextRoutes.HUB,
                        inclusive = false,
                    )
                },
            )
        }
    }
}
