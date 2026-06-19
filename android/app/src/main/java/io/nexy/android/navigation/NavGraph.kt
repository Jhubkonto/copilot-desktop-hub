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
import io.nexy.android.ui.agentgenerator.AgentGeneratorScreen
import io.nexy.android.ui.chat.ChatScreen
import io.nexy.android.ui.projects.ProjectConfigScreen
import io.nexy.android.ui.home.AgentConfigScreen
import io.nexy.android.ui.home.HistoryScope
import io.nexy.android.ui.home.HomeScreen
import io.nexy.android.ui.home.ScopedChatHistoryScreen
import io.nexy.android.ui.pairing.PairingScreen
import io.nexy.android.ui.pairing.PairingStartScreen
import io.nexy.android.ui.selfheal.SelfHealReportDetailScreen
import io.nexy.android.ui.selfheal.SelfHealReportsScreen
import io.nexy.android.ui.artifacts.ArtifactsScreen
import io.nexy.android.ui.projectgenerator.ProjectGeneratorScreen
import io.nexy.android.ui.prompts.PromptsScreen
import io.nexy.android.ui.wiki.WikiScreen
import io.nexy.android.ui.settings.AppearanceScreen
import io.nexy.android.ui.settings.ConnectionScreen
import io.nexy.android.ui.settings.DiagnosticsScreen
import io.nexy.android.ui.settings.GlobalSettingsScreen
import io.nexy.android.ui.settings.McpAndCliScreen
import io.nexy.android.ui.settings.ModelsScreen
import io.nexy.android.ui.settings.NotificationsScreen
import io.nexy.android.ui.settings.ProvidersScreen
import io.nexy.android.ui.settings.SettingsScreen
import io.nexy.android.ui.settings.UpdatesScreen
import io.nexy.android.ui.splash.SplashScreen

@Composable
fun NavGraph(onRequestNotificationPermission: () -> Unit = {}) {
    val navController = rememberNavController()
    val connectionState by WsRepository.connectionState.collectAsState()

    // Track whether this was a brand-new pairing (no saved profiles before connecting).
    val wasFirstPairing = androidx.compose.runtime.remember {
        androidx.compose.runtime.mutableStateOf(!WsRepository.hasPairedServer())
    }
    val onPairingConnected: () -> Unit = androidx.compose.runtime.remember(navController, onRequestNotificationPermission) {
        {
            if (wasFirstPairing.value) {
                onRequestNotificationPermission()
                wasFirstPairing.value = false
            }
            navController.navigate("home") {
                popUpTo("pairing") { inclusive = true }
            }
        }
    }

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
                onConnected = { onPairingConnected() },
            )
        }

        composable("pairing/scan") {
            PairingScreen(
                onBack = { navController.popBackStack() },
                onConnected = { onPairingConnected() },
            )
        }

        composable("pairing/manual") {
            PairingScreen(
                initialShowManual = true,
                onBack = { navController.popBackStack() },
                onConnected = { onPairingConnected() },
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
                onOpenAgentConfig = { agentId ->
                    navController.navigate("agent-config/${Uri.encode(agentId)}")
                },
                onOpenProjectHistory = { projectId ->
                    navController.navigate("history/project/${Uri.encode(projectId)}")
                },
                onOpenProjectConfig = { projectId ->
                    navController.navigate("project-config/${Uri.encode(projectId)}")
                },
                onOpenProjectGenerator = {
                    navController.navigate("project-generator")
                },
                onOpenAgentGenerator = {
                    navController.navigate("agent-generator")
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
                onOpenFork = { forkedId -> navController.navigate("chat/$forkedId") },
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
                onOpenAppearance = { navController.navigate("settings/appearance") },
                onOpenConnection = { navController.navigate("settings/connection") },
                onOpenModels = { navController.navigate("settings/models") },
                onOpenNotifications = { navController.navigate("settings/notifications") },
                onOpenUpdates = { navController.navigate("settings/updates") },
                onOpenDiagnostics = { navController.navigate("settings/diagnostics") },
                onOpenSelfHeal = { navController.navigate("self-heal") },
                onOpenProviders = { navController.navigate("providers") },
                onOpenProjectGenerator = { navController.navigate("project-generator") },
                onOpenArtifacts = { navController.navigate("artifacts") },
                onOpenPromptLibrary = { navController.navigate("prompts") },
                onOpenGlobalSettings = { navController.navigate("settings/global") },
                onOpenMcpAndCli = { navController.navigate("settings/mcp-cli") },
            )
        }

        composable("settings/global") {
            GlobalSettingsScreen(onBack = { navController.popBackStack() })
        }

        composable("settings/mcp-cli") {
            McpAndCliScreen(onBack = { navController.popBackStack() })
        }

        composable("settings/appearance") {
            AppearanceScreen(onBack = { navController.popBackStack() })
        }

        composable("settings/connection") {
            ConnectionScreen(
                onBack = { navController.popBackStack() },
                onForgetServer = {
                    navController.navigate("pairing") {
                        popUpTo(0) { inclusive = true }
                    }
                },
            )
        }

        composable("settings/models") {
            ModelsScreen(onBack = { navController.popBackStack() })
        }

        composable("settings/notifications") {
            NotificationsScreen(onBack = { navController.popBackStack() })
        }

        composable("settings/updates") {
            UpdatesScreen(onBack = { navController.popBackStack() })
        }

        composable("settings/diagnostics") {
            DiagnosticsScreen(
                onBack = { navController.popBackStack() },
                onForgetServer = {
                    navController.navigate("pairing") {
                        popUpTo(0) { inclusive = true }
                    }
                },
            )
        }

        composable("providers") {
            ProvidersScreen(onBack = { navController.popBackStack() })
        }

        composable("project-generator") {
            ProjectGeneratorScreen(onBack = { navController.popBackStack() })
        }

        composable("agent-generator") {
            AgentGeneratorScreen(onBack = { navController.popBackStack() })
        }

        composable(
            route = "project-config/{projectId}",
            arguments = listOf(navArgument("projectId") { type = NavType.StringType }),
        ) { backStackEntry ->
            val projectId = backStackEntry.arguments?.getString("projectId") ?: return@composable
            ProjectConfigScreen(
                projectId = projectId,
                onBack = { navController.popBackStack() },
                onOpenWiki = { navController.navigate("wiki/${Uri.encode(projectId)}") },
            )
        }

        composable("artifacts") {
            ArtifactsScreen(onBack = { navController.popBackStack() })
        }

        composable("prompts") {
            PromptsScreen(onBack = { navController.popBackStack() })
        }

        composable("self-heal") {
            SelfHealReportsScreen(
                onBack = { navController.popBackStack() },
                onOpenReport = { id -> navController.navigate("self-heal/$id") },
            )
        }

        composable(
            route = "self-heal/{reportId}",
            arguments = listOf(navArgument("reportId") { type = NavType.StringType }),
        ) { backStackEntry ->
            val reportId = backStackEntry.arguments?.getString("reportId") ?: return@composable
            SelfHealReportDetailScreen(reportId = reportId, onBack = { navController.popBackStack() })
        }

        composable(
            route = "agent-config/{agentId}",
            arguments = listOf(navArgument("agentId") { type = NavType.StringType }),
        ) { backStackEntry ->
            val agentId = backStackEntry.arguments?.getString("agentId") ?: return@composable
            AgentConfigScreen(agentId = agentId, onBack = { navController.popBackStack() })
        }

        composable(
            route = "wiki/{projectId}",
            arguments = listOf(navArgument("projectId") { type = NavType.StringType }),
        ) { backStackEntry ->
            val projectId = backStackEntry.arguments?.getString("projectId") ?: return@composable
            WikiScreen(projectId = projectId, onBack = { navController.popBackStack() })
        }
    }
}
