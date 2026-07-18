package io.nexy.android.ui.ratings

import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.viewmodel.compose.viewModel
import com.github.mikephil.charting.charts.HorizontalBarChart
import com.github.mikephil.charting.charts.LineChart
import com.github.mikephil.charting.components.XAxis
import com.github.mikephil.charting.data.BarData
import com.github.mikephil.charting.data.BarDataSet
import com.github.mikephil.charting.data.BarEntry
import com.github.mikephil.charting.data.Entry
import com.github.mikephil.charting.data.LineData
import com.github.mikephil.charting.data.LineDataSet
import com.github.mikephil.charting.formatter.IndexAxisValueFormatter
import io.nexy.android.data.model.ConversationRatingListItem
import io.nexy.android.data.model.RatingAggregate
import io.nexy.android.data.model.RatingTrendPoint
import io.nexy.android.ui.components.NexyTopAppBar

private enum class RatingsSort { RECENT, RATING }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RatingsScreen(
    onBack: () -> Unit,
    onOpenConversation: (String) -> Unit,
    vm: RatingsViewModel = viewModel(),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    var query by remember { mutableStateOf("") }
    var sort by remember { mutableStateOf(RatingsSort.RECENT) }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("Ratings", style = MaterialTheme.typography.titleMedium) },
                onBack = onBack,
            )
        },
    ) { padding ->
        when (val current = state) {
            is RatingsUiState.Loading -> {
                Box(modifier = Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            }
            is RatingsUiState.Error -> {
                Box(modifier = Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                    Text(current.message, color = MaterialTheme.colorScheme.error)
                }
            }
            is RatingsUiState.Loaded -> {
                val filtered = current.ratings
                    .filter { item ->
                        query.isBlank() ||
                            item.conversationTitle.contains(query, ignoreCase = true) ||
                            (item.agentName ?: "").contains(query, ignoreCase = true) ||
                            (item.model ?: "").contains(query, ignoreCase = true) ||
                            (item.projectName ?: "").contains(query, ignoreCase = true) ||
                            item.toolNames.any { it.contains(query, ignoreCase = true) } ||
                            item.skillNames.any { it.contains(query, ignoreCase = true) }
                    }
                    .sortedWith(
                        if (sort == RatingsSort.RATING) compareByDescending { it.rating }
                        else compareByDescending { it.updatedAt },
                    )

                LazyColumn(modifier = Modifier.fillMaxSize().padding(padding)) {
                    val stats = current.stats
                    if (stats != null && stats.hasAnyData()) {
                        item { RatingTrendChartCard(stats.trend) }
                        item { RatingBarChartCard("Average by Agent", stats.averageByAgent) }
                        item { RatingBarChartCard("Average by Model", stats.averageByModel) }
                        item { RatingBarChartCard("Average by Skill", stats.averageBySkill) }
                        item { RatingBarChartCard("Average by MCP Server", stats.averageByServer) }
                        item { RatingBarChartCard("Average by Project", stats.averageByProject) }
                        item { HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant) }
                    }

                    item {
                        Column(modifier = Modifier.fillMaxWidth().padding(16.dp)) {
                            OutlinedTextField(
                                value = query,
                                onValueChange = { query = it },
                                placeholder = { Text("Search ratings…") },
                                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                            )
                            androidx.compose.foundation.layout.Spacer(Modifier.height(8.dp))
                            SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                                listOf(RatingsSort.RECENT to "Recent", RatingsSort.RATING to "Rating").forEachIndexed { i, (value, label) ->
                                    SegmentedButton(
                                        selected = sort == value,
                                        onClick = { sort = value },
                                        shape = SegmentedButtonDefaults.itemShape(index = i, count = 2),
                                        modifier = Modifier.weight(1f),
                                    ) {
                                        Text(label, style = MaterialTheme.typography.labelSmall)
                                    }
                                }
                            }
                        }
                    }

                    if (filtered.isEmpty()) {
                        item {
                            Box(modifier = Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                                Text(
                                    if (query.isBlank()) "No conversations rated yet" else "No ratings match \"$query\"",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    } else {
                        items(filtered, key = { it.id }) { item ->
                            RatingListRow(item = item, onClick = { onOpenConversation(item.conversationId) })
                        }
                    }
                    item { androidx.compose.foundation.layout.Spacer(modifier = Modifier.padding(bottom = 16.dp)) }
                }
            }
        }
    }
}

private fun io.nexy.android.data.model.ConversationRatingStats.hasAnyData(): Boolean =
    averageByAgent.isNotEmpty() || averageByModel.isNotEmpty() || averageBySkill.isNotEmpty() ||
        averageByServer.isNotEmpty() || averageByProject.isNotEmpty() || trend.isNotEmpty()

@Composable
private fun RatingListRow(item: ConversationRatingListItem, onClick: () -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 2.dp),
        shape = MaterialTheme.shapes.medium,
        tonalElevation = 1.dp,
    ) {
        Column(modifier = Modifier.fillMaxWidth().padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    item.conversationTitle,
                    style = MaterialTheme.typography.bodyLarge,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                StarRow(rating = item.rating)
            }
            val subtitle = listOfNotNull(item.projectName, item.agentName, item.model).joinToString(" · ")
            if (subtitle.isNotBlank()) {
                Text(subtitle, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            val tags = item.toolNames + item.skillNames
            if (tags.isNotEmpty()) {
                Text(
                    tags.joinToString(" · "),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (!item.note.isNullOrBlank()) {
                Text(
                    "\"${item.note}\"",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun StarRow(rating: Int) {
    Row(horizontalArrangement = Arrangement.spacedBy(1.dp)) {
        for (star in 1..5) {
            Icon(
                imageVector = if (star <= rating) Icons.Default.Star else Icons.Default.StarBorder,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.tertiary,
                modifier = Modifier.height(14.dp),
            )
        }
    }
}

@Composable
private fun RatingBarChartCard(title: String, data: List<RatingAggregate>) {
    if (data.isEmpty()) return
    val top = data.take(8)
    val barColor = MaterialTheme.colorScheme.primary.toArgb()
    val textColor = MaterialTheme.colorScheme.onSurfaceVariant.toArgb()
    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        Text(title, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        AndroidView(
            modifier = Modifier.fillMaxWidth().height((top.size * 36 + 32).dp),
            factory = { context -> HorizontalBarChart(context) },
            update = { chart ->
                val reversed = top.reversed()
                val entries = reversed.mapIndexed { i, agg -> BarEntry(i.toFloat(), agg.average.toFloat()) }
                val dataSet = BarDataSet(entries, "Average rating").apply {
                    color = barColor
                    valueTextColor = textColor
                    valueTextSize = 10f
                }
                chart.data = BarData(dataSet).apply { barWidth = 0.6f }
                chart.axisLeft.axisMinimum = 0f
                chart.axisLeft.axisMaximum = 5f
                chart.axisLeft.textColor = textColor
                chart.axisRight.isEnabled = false
                chart.description.isEnabled = false
                chart.legend.isEnabled = false
                chart.xAxis.valueFormatter = IndexAxisValueFormatter(reversed.map { it.label })
                chart.xAxis.granularity = 1f
                chart.xAxis.position = XAxis.XAxisPosition.BOTTOM
                chart.xAxis.textColor = textColor
                chart.setFitBars(true)
                chart.invalidate()
            },
        )
    }
}

@Composable
private fun RatingTrendChartCard(data: List<RatingTrendPoint>) {
    if (data.isEmpty()) return
    val lineColor = MaterialTheme.colorScheme.primary.toArgb()
    val textColor = MaterialTheme.colorScheme.onSurfaceVariant.toArgb()
    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        Text("Rating Trend", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        AndroidView(
            modifier = Modifier.fillMaxWidth().height(160.dp),
            factory = { context -> LineChart(context) },
            update = { chart ->
                val entries = data.mapIndexed { i, point -> Entry(i.toFloat(), point.average.toFloat()) }
                val dataSet = LineDataSet(entries, "Average rating").apply {
                    color = lineColor
                    setCircleColor(lineColor)
                    lineWidth = 2f
                    circleRadius = 3f
                    setDrawValues(false)
                }
                chart.data = LineData(dataSet)
                chart.axisLeft.axisMinimum = 0f
                chart.axisLeft.axisMaximum = 5f
                chart.axisLeft.textColor = textColor
                chart.axisRight.isEnabled = false
                chart.description.isEnabled = false
                chart.legend.isEnabled = false
                chart.xAxis.valueFormatter = IndexAxisValueFormatter(data.map { it.date })
                chart.xAxis.granularity = 1f
                chart.xAxis.position = XAxis.XAxisPosition.BOTTOM
                chart.xAxis.textColor = textColor
                chart.invalidate()
            },
        )
    }
}
