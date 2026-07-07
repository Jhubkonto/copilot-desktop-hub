package io.nexy.android.navigation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.navigation.compose.rememberNavController
import io.nexy.android.data.BackgroundActivityTracker
import io.nexy.android.ui.home.BackgroundActivityDock
import kotlinx.coroutines.flow.MutableStateFlow

@Composable
fun AppShell(
    onRequestNotificationPermission: () -> Unit = {},
    pendingDeeplink: MutableStateFlow<String?> = MutableStateFlow(null),
) {
    val navController = rememberNavController()
    val backgroundActivities by BackgroundActivityTracker.activities.collectAsState()

    Box(modifier = Modifier.fillMaxSize()) {
        NavGraph(
            providedNavController = navController,
            onRequestNotificationPermission = onRequestNotificationPermission,
            pendingDeeplink = pendingDeeplink,
        )
        BackgroundActivityDock(
            activities = backgroundActivities,
            onOpenActivity = { activity -> navController.navigate(activity.route) },
            modifier = Modifier.align(Alignment.BottomCenter),
        )
    }
}
