package io.nexy.android.ui.home

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.nexy.android.data.BackgroundActivity
import io.nexy.android.data.BackgroundActivityTracker
import io.nexy.android.data.WsRepository
import io.nexy.android.ui.components.NexyTopAppBar

/** Full-screen activity feed — styled like the chat/project/agent history screens, per the
 *  edge tab that opens it. Reflects the same [BackgroundActivityTracker] state as the tab. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ActivityFeedScreen(
    onBack: () -> Unit,
    onOpenActivity: (BackgroundActivity) -> Unit,
) {
    val activities by BackgroundActivityTracker.activities.collectAsState()
    var isRefreshing by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = {
                    Column {
                        Text("Activity", maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(
                            "${activities.size} in progress",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                onBack = onBack,
            )
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = isRefreshing,
            onRefresh = {
                isRefreshing = true
                WsRepository.getActivityFeed()
                isRefreshing = false
            },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            if (activities.isEmpty()) {
                Column(
                    modifier = Modifier.fillMaxSize(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Text(
                        "Nothing in progress right now.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                LazyColumn(modifier = Modifier.fillMaxSize()) {
                    items(activities, key = { it.id }) { activity ->
                        ActivityFeedRow(activity = activity, onClick = { onOpenActivity(activity) })
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                }
            }
        }
    }
}

@Composable
private fun ActivityFeedRow(activity: BackgroundActivity, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
        Text(
            activity.label,
            style = MaterialTheme.typography.bodyMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
