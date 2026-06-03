package io.nexy.android.navigation

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
import io.nexy.android.ui.home.HomeScreen
import io.nexy.android.ui.pairing.PairingScreen
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
            PairingScreen(onConnected = {
                navController.navigate("home") {
                    popUpTo("pairing") { inclusive = true }
                }
            })
        }

        composable("home") {
            HomeScreen(
                onOpenChat = { conversationId ->
                    navController.navigate("chat/$conversationId")
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
            route = "chat/{conversationId}",
            arguments = listOf(navArgument("conversationId") { type = NavType.StringType }),
        ) { backStack ->
            val conversationId = backStack.arguments?.getString("conversationId") ?: ""
            ChatScreen(
                conversationId = conversationId,
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
