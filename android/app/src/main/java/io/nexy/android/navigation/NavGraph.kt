package io.nexy.android.navigation

import android.net.Uri
import android.os.Bundle
import androidx.compose.runtime.Composable
import androidx.navigation.NavController
import androidx.navigation.NavDestination
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.filterNotNull
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.navigation.NavType
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import io.nexy.android.data.WsRepository
import io.nexy.android.ui.agentgenerator.AgentGeneratorScreen
import io.nexy.android.ui.skillgenerator.SkillGeneratorScreen
import io.nexy.android.ui.chat.ChatScreen
import io.nexy.android.ui.projects.ProjectConfigScreen
import io.nexy.android.ui.projects.ProjectAuditScreen
import io.nexy.android.ui.projects.AutomatedWorkflowScreen
import io.nexy.android.ui.home.ActivityFeedScreen
import io.nexy.android.ui.home.AgentConfigScreen
import io.nexy.android.ui.home.HistoryScope
import io.nexy.android.ui.home.HomeScreen
import io.nexy.android.ui.home.ScopedChatHistoryScreen
import io.nexy.android.ui.pairing.PairingScreen
import io.nexy.android.ui.pairing.PairingStartScreen
import io.nexy.android.ui.remoteedit.RemoteEditReportDetailScreen
import io.nexy.android.ui.remoteedit.RemoteEditReportsScreen
import io.nexy.android.ui.remoteedit.RemoteEditStartScreen
import io.nexy.android.ui.artifacts.ArtifactsScreen
import io.nexy.android.ui.projectgenerator.ProjectGeneratorScreen
import io.nexy.android.ui.prompts.PromptsScreen
import io.nexy.android.ui.wiki.WikiScreen
import io.nexy.android.ui.settings.AppearanceScreen
import io.nexy.android.ui.settings.ConnectionScreen
import io.nexy.android.ui.settings.DiagnosticsScreen
import io.nexy.android.ui.settings.GlobalSettingsScreen
import io.nexy.android.ui.settings.BuildDashboardScreen
import io.nexy.android.ui.settings.DebugLogScreen
import io.nexy.android.ui.settings.McpServersScreen
import io.nexy.android.ui.settings.CliModelsScreen
import io.nexy.android.ui.settings.ModelsScreen
import io.nexy.android.ui.settings.NotificationsScreen
import io.nexy.android.ui.settings.ProvidersScreen
import io.nexy.android.ui.settings.SettingsScreen
import io.nexy.android.ui.settings.UpdatesScreen
import io.nexy.android.ui.settings.BackupRecoveryScreen
import io.nexy.android.ui.scheduler.ScheduledScreen
import io.nexy.android.ui.scheduler.SchedulerTaskDetailScreen
import io.nexy.android.ui.scheduler.SchedulerTaskConfigScreen
import io.nexy.android.ui.schedulegenerator.ScheduleGeneratorScreen
import io.nexy.android.ui.skills.SkillsScreen
import io.nexy.android.ui.splash.SplashScreen
import io.nexy.android.ui.debrief.DebriefScreen
import io.nexy.android.ui.quiz.QuizScreen

@Composable
fun NavGraph(
    providedNavController: NavHostController? = null,
    onRequestNotificationPermission: () -> Unit = {},
    pendingDeeplink: MutableStateFlow<String?> = MutableStateFlow(null),
) {
    val navController = providedNavController ?: rememberNavController()
    // Track IDs navigated to from a "create" flow so config screens know to animate on save
    var newProjectId by remember { mutableStateOf<String?>(null) }
    var newAgentId by remember { mutableStateOf<String?>(null) }

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

    // Consume deeplinks from notification taps (cold-start and while-running)
    LaunchedEffect(navController) {
        pendingDeeplink.filterNotNull().collect { deeplink ->
            pendingDeeplink.value = null
            val currentRoute = navController.currentBackStackEntry?.destination?.route
            if (currentRoute == "home") {
                navController.navigate(deeplink)
            } else {
                navController.addOnDestinationChangedListener(object :
                    NavController.OnDestinationChangedListener {
                    override fun onDestinationChanged(
                        controller: NavController,
                        destination: NavDestination,
                        arguments: Bundle?,
                    ) {
                        if (destination.route == "home") {
                            controller.removeOnDestinationChangedListener(this)
                            controller.navigate(deeplink)
                        }
                    }
                })
            }
        }
    }

    NavHost(navController = navController, startDestination = "splash") {
        composable("splash") {
            SplashScreen(onFinished = {
                // Standalone is the default. Pairing remains available from Home and Settings,
                // while saved profiles reconnect in the background.
                navController.navigate("home") {
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
                onOpenAgentConfigNew = { agentId ->
                    newAgentId = agentId
                    navController.navigate("agent-config/${Uri.encode(agentId)}")
                },
                onOpenProjectHistory = { projectId ->
                    navController.navigate("history/project/${Uri.encode(projectId)}")
                },
                onOpenProjectConfig = { projectId ->
                    navController.navigate("project-config/${Uri.encode(projectId)}")
                },
                onOpenProjectConfigNew = { projectId ->
                    newProjectId = projectId
                    navController.navigate("project-config/${Uri.encode(projectId)}")
                },
                onOpenProjectGenerator = {
                    navController.navigate("project-generator")
                },
                onOpenAgentGenerator = {
                    navController.navigate("agent-generator")
                },
                onOpenArtifacts = {
                    navController.navigate("artifacts?artifactId=")
                },
                onOpenSkills = {
                    navController.navigate("skills")
                },
                onOpenScheduled = {
                    navController.navigate("scheduled")
                },
                onOpenSkillGenerator = {
                    navController.navigate("skill-generator")
                },
                onOpenSettings = {
                    navController.navigate("settings")
                },
                onOpenPairingScan = {
                    navController.navigate("home/add-server")
                },
                onNavigateRoute = { route ->
                    navController.navigate(route)
                },
            )
        }

        composable("home/add-server") {
            PairingScreen(
                onBack = { navController.popBackStack() },
                onConnected = { navController.popBackStack() },
            )
        }

        composable("activity-feed") {
            ActivityFeedScreen(
                onBack = { navController.popBackStack() },
                onOpenActivity = { activity -> navController.navigate(activity.route) },
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
                onOpenDebrief = { conversationId -> navController.navigate("debrief/${Uri.encode(conversationId)}") },
                onOpenQuiz = { conversationId -> navController.navigate("quiz/${Uri.encode(conversationId)}") },
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
            enterTransition = {
                slideInVertically(
                    initialOffsetY = { it / 6 },
                    animationSpec = tween(durationMillis = 280),
                ) + fadeIn(animationSpec = tween(durationMillis = 280))
            },
            exitTransition = {
                slideOutVertically(
                    targetOffsetY = { it / 8 },
                    animationSpec = tween(durationMillis = 220),
                ) + fadeOut(animationSpec = tween(durationMillis = 220))
            },
        ) { backStack ->
            val conversationId = backStack.arguments?.getString("conversationId") ?: ""
            val agentId = backStack.arguments?.getString("agentId")?.takeIf { it.isNotBlank() }
            val projectId = backStack.arguments?.getString("projectId")?.takeIf { it.isNotBlank() }
            ChatScreen(
                conversationId = conversationId,
                agentId = agentId,
                projectId = projectId,
                onBack = { navController.popBackStack() },
                onOpenArtifacts = { artifactId ->
                    navController.navigate("artifacts?artifactId=${Uri.encode(artifactId.orEmpty())}")
                },
                onOpenDebrief = { cid -> navController.navigate("debrief/${Uri.encode(cid)}") },
                onOpenQuiz = { cid, artifactId ->
                    navController.navigate("quiz/${Uri.encode(cid)}?artifactId=${Uri.encode(artifactId)}")
                },
                onOpenFork = { forkedId -> navController.navigate("chat/$forkedId") },
                onOpenRemoteEditWithPrefill = { prefill, projectIdForPrefill ->
                    navController.navigate(
                        "project-code-changes/${Uri.encode(projectIdForPrefill)}/new?prefill=${Uri.encode(prefill)}",
                    )
                },
                onOpenCodeChange = { reportId -> navController.navigate("remote-edit/${Uri.encode(reportId)}") },
                onOpenAutomatedWorkflow = { workflowProjectId -> navController.navigate("automated-workflow/${Uri.encode(workflowProjectId)}") },
                onNewChat = { newAgentId, newProjectId ->
                    val newConversationId = java.util.UUID.randomUUID().toString()
                    val agentParam = Uri.encode(newAgentId.orEmpty())
                    val projectParam = Uri.encode(newProjectId.orEmpty())
                    navController.navigate(
                        "chat/$newConversationId?agentId=$agentParam&projectId=$projectParam",
                    )
                },
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
                onOpenProviders = { navController.navigate("providers") },
                onOpenPromptLibrary = { navController.navigate("prompts") },
                onOpenGlobalSettings = { navController.navigate("settings/global") },
                onOpenMcpServers = { navController.navigate("settings/mcp-servers") },
                onOpenCliModels = { navController.navigate("settings/cli-models") },
                onOpenBuildDashboard = { navController.navigate("settings/build-dashboard") },
                onOpenDebugLog = { navController.navigate("settings/debug-log") },
                onOpenBackupRecovery = { navController.navigate("settings/backup") },
            )
        }

        composable("settings/build-dashboard") {
            BuildDashboardScreen(onBack = { navController.popBackStack() })
        }

        composable("settings/debug-log") {
            DebugLogScreen(onBack = { navController.popBackStack() })
        }

        composable("settings/backup") {
            BackupRecoveryScreen(onBack = { navController.popBackStack() })
        }

        composable("settings/global") {
            GlobalSettingsScreen(
                onBack = { navController.popBackStack() },
                onOpenProviders = { navController.navigate("providers") },
            )
        }

        composable("settings/mcp-servers") {
            McpServersScreen(onBack = { navController.popBackStack() })
        }

        composable("settings/cli-models") {
            CliModelsScreen(onBack = { navController.popBackStack() })
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
                onOpenPairingScan = {
                    navController.navigate("home/add-server")
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
                isNew = projectId == newProjectId,
                onOpenAudit = { navController.navigate("project-audit/${Uri.encode(projectId)}") },
                onOpenWiki = { navController.navigate("wiki/${Uri.encode(projectId)}") },
                onOpenArtifacts = { navController.navigate("artifacts?artifactId=") },
                onOpenAutomatedWorkflow = { navController.navigate("automated-workflow/${Uri.encode(projectId)}") },
            )
        }

        composable(
            route = "automated-workflow/{projectId}",
            arguments = listOf(navArgument("projectId") { type = NavType.StringType }),
        ) { backStackEntry ->
            val projectId = backStackEntry.arguments?.getString("projectId") ?: return@composable
            AutomatedWorkflowScreen(
                projectId = projectId,
                onBack = { navController.popBackStack() },
                onOpenConversation = { conversationId -> navController.navigate("chat/$conversationId") },
            )
        }

        composable(
            route = "project-audit/{projectId}",
            arguments = listOf(navArgument("projectId") { type = NavType.StringType }),
        ) { backStackEntry ->
            val projectId = backStackEntry.arguments?.getString("projectId") ?: return@composable
            ProjectAuditScreen(
                projectId = projectId,
                onBack = { navController.popBackStack() },
            )
        }

        composable(
            route = "artifacts?artifactId={artifactId}",
            arguments = listOf(
                navArgument("artifactId") {
                    type = NavType.StringType
                    defaultValue = ""
                },
            ),
        ) { backStackEntry ->
            val artifactId = backStackEntry.arguments?.getString("artifactId")?.takeIf { it.isNotBlank() }
            ArtifactsScreen(
                onBack = { navController.popBackStack() },
                initialArtifactId = artifactId,
            )
        }

        composable("skills") {
            SkillsScreen(
                onBack = { navController.popBackStack() },
                onOpenSkillGenerator = { navController.navigate("skill-generator") },
            )
        }

        composable("skill-generator") {
            SkillGeneratorScreen(onBack = { navController.popBackStack() })
        }

        composable("scheduled") {
            ScheduledScreen(
                onBack = { navController.popBackStack() },
                onNewTask = { navController.navigate("scheduled/new") },
                onOpenGenerator = { navController.navigate("scheduled/generator") },
                onTaskDetail = { taskId -> navController.navigate("scheduled/$taskId") },
            )
        }

        composable("scheduled/generator") {
            ScheduleGeneratorScreen(onBack = { navController.popBackStack() })
        }

        composable("scheduled/new") {
            SchedulerTaskConfigScreen(
                taskId = null,
                onBack = { navController.popBackStack() },
            )
        }

        composable(
            route = "scheduled/{taskId}",
            arguments = listOf(navArgument("taskId") { type = NavType.StringType }),
        ) { backStackEntry ->
            val taskId = backStackEntry.arguments?.getString("taskId") ?: return@composable
            SchedulerTaskDetailScreen(
                taskId = taskId,
                onBack = { navController.popBackStack() },
                onEdit = { id -> navController.navigate("scheduled/$id/edit") },
            )
        }

        composable(
            route = "scheduled/{taskId}/edit",
            arguments = listOf(navArgument("taskId") { type = NavType.StringType }),
        ) { backStackEntry ->
            val taskId = backStackEntry.arguments?.getString("taskId") ?: return@composable
            SchedulerTaskConfigScreen(
                taskId = taskId,
                onBack = { navController.popBackStack() },
            )
        }

        composable("prompts") {
            PromptsScreen(onBack = { navController.popBackStack() })
        }

        composable(
            route = "project-code-changes/{projectId}",
            arguments = listOf(navArgument("projectId") { type = NavType.StringType }),
        ) { backStackEntry ->
            val projectId = backStackEntry.arguments?.getString("projectId") ?: return@composable
            RemoteEditReportsScreen(
                projectId = projectId,
                onBack = { navController.popBackStack() },
                onOpenReport = { id -> navController.navigate("remote-edit/$id") },
                onNewRequest = { navController.navigate("project-code-changes/${Uri.encode(projectId)}/new") },
            )
        }

        composable(
            route = "project-code-changes/{projectId}/new?prefill={prefill}",
            arguments = listOf(
                navArgument("projectId") { type = NavType.StringType },
                navArgument("prefill") {
                    type = NavType.StringType
                    defaultValue = ""
                },
            ),
        ) { backStackEntry ->
            val projectId = backStackEntry.arguments?.getString("projectId") ?: return@composable
            val prefill = backStackEntry.arguments?.getString("prefill") ?: ""
            RemoteEditStartScreen(
                projectId = projectId,
                prefillDescription = prefill,
                onBack = { navController.popBackStack() },
                onReportCreated = { reportId -> navController.navigate("remote-edit/$reportId") },
            )
        }

        composable(
            route = "remote-edit/{reportId}",
            arguments = listOf(navArgument("reportId") { type = NavType.StringType }),
        ) { backStackEntry ->
            val reportId = backStackEntry.arguments?.getString("reportId") ?: return@composable
            RemoteEditReportDetailScreen(reportId = reportId, onBack = { navController.popBackStack() })
        }

        composable(
            route = "agent-config/{agentId}",
            arguments = listOf(navArgument("agentId") { type = NavType.StringType }),
        ) { backStackEntry ->
            val agentId = backStackEntry.arguments?.getString("agentId") ?: return@composable
            AgentConfigScreen(
                agentId = agentId,
                onBack = { navController.popBackStack() },
                isNew = agentId == newAgentId,
            )
        }

        composable(
            route = "wiki/{projectId}",
            arguments = listOf(navArgument("projectId") { type = NavType.StringType }),
        ) { backStackEntry ->
            val projectId = backStackEntry.arguments?.getString("projectId") ?: return@composable
            WikiScreen(projectId = projectId, onBack = { navController.popBackStack() })
        }

        composable(
            route = "debrief/{conversationId}",
            arguments = listOf(navArgument("conversationId") { type = NavType.StringType }),
            enterTransition = {
                slideInVertically(initialOffsetY = { it / 6 }, animationSpec = tween(280)) + fadeIn(tween(280))
            },
            exitTransition = {
                slideOutVertically(targetOffsetY = { it / 8 }, animationSpec = tween(220)) + fadeOut(tween(220))
            },
        ) { backStackEntry ->
            val conversationId = backStackEntry.arguments?.getString("conversationId") ?: return@composable
            DebriefScreen(
                conversationId = conversationId,
                onBack = { navController.popBackStack() },
                onQuizMe = { cid -> navController.navigate("quiz/${Uri.encode(cid)}") },
            )
        }

        composable(
            route = "quiz/{conversationId}?artifactId={artifactId}",
            arguments = listOf(
                navArgument("conversationId") { type = NavType.StringType },
                navArgument("artifactId") {
                    type = NavType.StringType
                    defaultValue = ""
                },
            ),
            enterTransition = {
                slideInVertically(initialOffsetY = { it / 6 }, animationSpec = tween(280)) + fadeIn(tween(280))
            },
            exitTransition = {
                slideOutVertically(targetOffsetY = { it / 8 }, animationSpec = tween(220)) + fadeOut(tween(220))
            },
        ) { backStackEntry ->
            val conversationId = backStackEntry.arguments?.getString("conversationId") ?: return@composable
            val artifactId = backStackEntry.arguments?.getString("artifactId")?.takeIf { it.isNotBlank() }
            QuizScreen(
                conversationId = conversationId,
                artifactId = artifactId,
                onBack = { navController.popBackStack() },
            )
        }
    }
}
