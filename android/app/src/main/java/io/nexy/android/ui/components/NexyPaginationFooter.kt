package io.nexy.android.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun NexyPaginationFooter(
    loadedCount: Int,
    totalCount: Int,
    hasMore: Boolean,
    isLoading: Boolean,
    error: String?,
    onLoadMore: () -> Unit,
    onRetry: () -> Unit,
) {
    if (totalCount == 0 && !isLoading && error == null) return
    Column(
        modifier = Modifier.padding(vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(
            "${loadedCount.coerceAtMost(totalCount)} of $totalCount",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        when {
            error != null -> TextButton(onClick = onRetry) { Text("Retry") }
            hasMore -> TextButton(onClick = onLoadMore, enabled = !isLoading) {
                Text(if (isLoading) "Loading…" else "Load more")
            }
            isLoading -> Text("Loading…", style = MaterialTheme.typography.labelSmall)
        }
    }
}
