package io.nexy.android.navigation

import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.WsRepository
import io.nexy.android.ui.chat.ChatScreen
import io.nexy.android.ui.home.HistoryScope
import io.nexy.android.ui.home.HomeScreen
import io.nexy.android.ui.home.ScopedChatHistoryScreen
import io.nexy.android.ui.pairing.PairingScreen
import io.nexy.android.ui.pairing.PairingStartScreen
import io.nexy.android.ui.settings.SettingsScreen
import io.nexy.android.ui.splash.SplashScreen

@Composable
fun NavGraph() {
    val navController = rememberNavController()
    val connectionState by WsRepository.connectionState.collectAsState()

    NavHost(navController = navController, startDestination = "splash") {
        composable("splash") {
            SplashScreen(onFinished = {
                val dest = if (connectionState == ConnectionState.CONNECTED) "home" else "pairing"
                navController.navigate(dest) {
                    popUpTo("splash") { inclusive = true }
                }
            })
        }

        composable("pairing") {
            PairingStartScreen(
                onScanQr = { navController.navigate("pairing/scan") },
                onManualEntry = { navController.navigate("pairing/manual") },
                onConnected = {
                    navController.navigate("home") {
                        popUpTo("pairing") { inclusive = true }
                    }
                },
            )
        }

        composable("pairing/scan") {
            PairingScreen(onConnected = {
                navController.navigate("home") {
                    popUpTo("pairing") { inclusive = true }
                }
            })
        }

        composable("pairing/manual") {
            PairingScreen(
                initialShowManual = true,
                onConnected = {
                    navController.navigate("home") {
                        popUpTo("pairing") { inclusive = true }
                    }
                },
            )
        }

        composable("home") {
            HomeScreen(
                onOpenChat = { conversationId ->
                    navController.navigate("chat/$conversationId")
                },
                onOpenDraftChat = { conversationId, agentId, projectId ->
                    val agentParam = Uri.encode(agentId.orEmpty())
                    val projectParam = Uri.encode(projectId.orEmpty())
                    navController.navigate("chat/$conversationId?agentId=$agentParam&projectId=$projectParam")
                },
                onOpenAgentHistory = { agentId ->
                    navController.navigate("history/agent/${Uri.encode(agentId)}")
                },
                onOpenProjectHistory = { projectId ->
                    navController.navigate("history/project/${Uri.encode(projectId)}")
                },
                onDisconnected = {
                    navController.navigate("pairing") {
                        popUpTo("home") { inclusive = true }
                    }
                },
                onOpenSettings = {
                    navController.navigate("settings")
                },
            )
        }

        composable(
            route = "history/{scope}/{scopeId}",
            arguments = listOf(
                navArgument("scope") { type = NavType.StringType },
                navArgument("scopeId") { type = NavType.StringType },
            ),
        ) { backStack ->
            val scope = when (backStack.arguments?.getString("scope")) {
                "agent" -> HistoryScope.Agent
                "project" -> HistoryScope.Project
                else -> HistoryScope.Project
            }
            val scopeId = backStack.arguments?.getString("scopeId") ?: ""
            ScopedChatHistoryScreen(
                scopeType = scope,
                scopeId = scopeId,
                onBack = { navController.popBackStack() },
                onOpenChat = { conversationId -> navController.navigate("chat/$conversationId") },
                onOpenDraftChat = { conversationId, agentId, projectId ->
                    val agentParam = Uri.encode(agentId.orEmpty())
                    val projectParam = Uri.encode(projectId.orEmpty())
                    navController.navigate("chat/$conversationId?agentId=$agentParam&projectId=$projectParam")
                },
            )
        }

        composable(
            route = "chat/{conversationId}?agentId={agentId}&projectId={projectId}",
            arguments = listOf(
                navArgument("conversationId") { type = NavType.StringType },
                navArgument("agentId") {
                    type = NavType.StringType
                    defaultValue = ""
                },
                navArgument("projectId") {
                    type = NavType.StringType
                    defaultValue = ""
                },
            ),
        ) { backStack ->
            val conversationId = backStack.arguments?.getString("conversationId") ?: ""
            val agentId = backStack.arguments?.getString("agentId")?.takeIf { it.isNotBlank() }
            val projectId = backStack.arguments?.getString("projectId")?.takeIf { it.isNotBlank() }
            ChatScreen(
                conversationId = conversationId,
                agentId = agentId,
                projectId = projectId,
                onBack = { navController.popBackStack() },
            )
        }

        composable("settings") {
            SettingsScreen(
                onBack = { navController.popBackStack() },
                onForgetServer = {
                    navController.navigate("pairing") {
                        popUpTo(0) { inclusive = true }
                    }
                },
            )
        }
    }
}
