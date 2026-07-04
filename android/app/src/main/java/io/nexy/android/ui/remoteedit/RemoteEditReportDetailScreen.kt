package io.nexy.android.ui.remoteedit

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.TextFields
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import android.content.ClipData
import android.content.ClipboardManager
import android.widget.TextView
import io.noties.markwon.Markwon
import io.noties.markwon.ext.strikethrough.StrikethroughPlugin
import io.noties.markwon.ext.tables.TablePlugin
import io.noties.markwon.ext.tables.TableTheme
import io.noties.markwon.ext.tasklist.TaskListPlugin
import io.noties.markwon.linkify.LinkifyPlugin
import androidx.compose.ui.viewinterop.AndroidView
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.CODE_CHANGE_PHASE_GUIDANCE
import io.nexy.android.data.model.CODE_CHANGE_PHASE_LABELS
import io.nexy.android.data.model.CodeChangeRequestPhase
import io.nexy.android.data.model.ErrorReport
import io.nexy.android.data.model.RemoteEditInvestigationSettings
import io.nexy.android.data.model.RemoteEditStagedFileEntry
import io.nexy.android.data.model.WsEvent
import io.nexy.android.data.model.deriveCodeChangePhase
import io.nexy.android.ui.components.FileLeafRow
import io.nexy.android.ui.components.FileTreeNode
import io.nexy.android.ui.components.FileTreeView
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.components.NexyDangerButton
import io.nexy.android.ui.components.NexyDiffContent
import io.nexy.android.ui.components.NexyGhostButton
import io.nexy.android.ui.components.NexyPrimaryButton
import io.nexy.android.ui.components.NexySecondaryButton
import io.nexy.android.ui.components.NexyTopAppBar
import io.nexy.android.ui.components.buildFileTree
import io.nexy.android.ui.components.renderDiffHunks
import io.nexy.android.ui.theme.LocalNexyColors
import io.nexy.android.ui.chat.ModelPickerSheet
import io.nexy.android.ui.chat.OnDeviceVoiceButton
import io.nexy.android.ui.chat.PromptLibrarySheetContent
import io.nexy.android.ui.chat.copyMessage
import io.nexy.android.ui.model.activeModelLabel
import kotlinx.coroutines.launch

private val CODE_CHANGE_PHASE_ORDER = listOf(
    CodeChangeRequestPhase.DRAFT,
    CodeChangeRequestPhase.INVESTIGATING,
    CodeChangeRequestPhase.PATCH_READY,
    CodeChangeRequestPhase.APPLIED,
    CodeChangeRequestPhase.VERIFYING,
    CodeChangeRequestPhase.READY_TO_COMMIT,
    CodeChangeRequestPhase.COMMITTED,
)

// Mirrors the desktop PhaseBar pill styling (src/renderer/components/ui/primitives.tsx) —
// fixed hex colors (not theme-role containers) so both platforms render the same badges.
private data class PhaseStepColors(val container: Color, val content: Color)

@Composable
private fun phaseStepColors(dark: Boolean): Map<String, PhaseStepColors> = if (dark) {
    mapOf(
        "done" to PhaseStepColors(Color(0xFF14532D).copy(alpha = 0.3f), Color(0xFF4ADE80)),
        "active" to PhaseStepColors(Color(0xFF1E3A8A).copy(alpha = 0.3f), Color(0xFF60A5FA)),
        "upcoming" to PhaseStepColors(Color(0xFF1F2937), Color(0xFF4B5563)),
        "failed" to PhaseStepColors(Color(0xFF7F1D1D).copy(alpha = 0.3f), Color(0xFFF87171)),
    )
} else {
    mapOf(
        "done" to PhaseStepColors(Color(0xFFDCFCE7), Color(0xFF15803D)),
        "active" to PhaseStepColors(Color(0xFFDBEAFE), Color(0xFF1D4ED8)),
        "upcoming" to PhaseStepColors(Color(0xFFF3F4F6), Color(0xFF9CA3AF)),
        "failed" to PhaseStepColors(Color(0xFFFEE2E2), Color(0xFFB91C1C)),
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PhaseStepper(
    phase: CodeChangeRequestPhase,
    onStepClick: (CodeChangeRequestPhase) -> Unit,
) {
    val currentIndex = if (phase == CodeChangeRequestPhase.NEEDS_ATTENTION) {
        CODE_CHANGE_PHASE_ORDER.indexOf(CodeChangeRequestPhase.VERIFYING)
    } else {
        CODE_CHANGE_PHASE_ORDER.indexOf(phase).coerceAtLeast(0)
    }
    val failed = phase == CodeChangeRequestPhase.NEEDS_ATTENTION
    val dark = LocalNexyColors.current.isDark
    val colors = phaseStepColors(dark)
    val connectorDone = Color(0xFF4ADE80)
    val connectorUpcoming = if (dark) Color(0xFF374151) else Color(0xFFE5E7EB)

    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        CODE_CHANGE_PHASE_ORDER.forEachIndexed { index, step ->
            val isFailedStep = failed && step == CodeChangeRequestPhase.VERIFYING
            val done = !isFailedStep && currentIndex > index
            val active = !isFailedStep && currentIndex == index
            val reached = done || active || isFailedStep
            val stepColors = when {
                isFailedStep -> colors.getValue("failed")
                done -> colors.getValue("done")
                active -> colors.getValue("active")
                else -> colors.getValue("upcoming")
            }

            if (index > 0) {
                Box(
                    modifier = Modifier
                        .width(16.dp)
                        .height(1.dp)
                        .align(Alignment.CenterVertically)
                        .background(if (done) connectorDone else connectorUpcoming),
                )
            }

            Surface(
                modifier = Modifier.clickable(enabled = reached) { onStepClick(step) },
                shape = RoundedCornerShape(percent = 50),
                color = stepColors.container,
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(3.dp),
                ) {
                    if (done) {
                        Icon(
                            Icons.Default.CheckCircle,
                            contentDescription = null,
                            tint = stepColors.content,
                            modifier = Modifier.size(10.dp),
                        )
                    }
                    Text(
                        text = CODE_CHANGE_PHASE_LABELS.getValue(step),
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Medium,
                        color = stepColors.content,
                        maxLines = 1,
                    )
                }
            }
        }
    }
}

// Removes the YAML front matter block investigator.ts asks the model to emit
// (confidence/root_cause/affected_files — already available as structured report fields, shown
// via PlanCard instead). The model doesn't always follow the "---delimited, at the very
// start" instruction exactly, so this mirrors the same two forms the backend parser
// (extractFrontMatterCandidates in investigator.ts) already tolerates: a `---`-delimited block
// (anchored to the start, per the prompt) or a ```yaml fenced block (which can appear anywhere).
private fun stripFrontMatter(markdown: String): String {
    return markdown
        .replaceFirst(Regex("^---\\n[\\s\\S]*?\\n---\\s*\\n?"), "")
        .replaceFirst(Regex("```ya?ml\\s*\\n[\\s\\S]*?```\\s*\\n?", RegexOption.IGNORE_CASE), "")
        .trim()
}

// Lighter-weight than ChatScreenBubbles' Markwon instance (no Prism4j syntax highlighting) since
// plan bodies are prose/lists/tables, not code-heavy chat responses.
@Composable
private fun rememberPlanMarkwon(): Markwon {
    val context = LocalContext.current
    val colorScheme = MaterialTheme.colorScheme
    return remember(context, colorScheme) {
        val dip = io.noties.markwon.utils.Dip.create(context)
        val tableTheme = TableTheme.emptyBuilder()
            .tableBorderColor(colorScheme.outlineVariant.toArgb())
            .tableBorderWidth(dip.toPx(1))
            .tableCellPadding(dip.toPx(8))
            .tableHeaderRowBackgroundColor(colorScheme.surfaceVariant.toArgb())
            .tableEvenRowBackgroundColor(colorScheme.surface.toArgb())
            .tableOddRowBackgroundColor(colorScheme.surfaceVariant.copy(alpha = 0.3f).toArgb())
            .build()
        Markwon.builder(context)
            .usePlugin(TablePlugin.create(tableTheme))
            .usePlugin(LinkifyPlugin.create())
            .usePlugin(StrikethroughPlugin.create())
            .usePlugin(
                TaskListPlugin.create(
                    colorScheme.primary.toArgb(),
                    colorScheme.onPrimary.toArgb(),
                    colorScheme.outline.toArgb(),
                ),
            )
            .build()
    }
}

// Long-press to copy, matching the chat bubble pattern in ChatScreenBubbles.kt.
@Composable
private fun MarkdownText(
    markdown: String,
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.onSurfaceVariant,
    textSizeSp: Float = 13f,
) {
    val markwon = rememberPlanMarkwon()
    val context = LocalContext.current
    val clipboardManager = remember(context) { context.getSystemService(ClipboardManager::class.java) }
    var menuExpanded by remember { mutableStateOf(false) }
    val colorArgb = color.toArgb()

    Box(modifier = modifier.combinedClickable(onClick = {}, onLongClick = { menuExpanded = true })) {
        DropdownMenu(expanded = menuExpanded, onDismissRequest = { menuExpanded = false }) {
            DropdownMenuItem(
                text = { Text("Copy") },
                onClick = {
                    menuExpanded = false
                    copyMessage(clipboardManager, markdown)
                },
            )
        }
        AndroidView(
            modifier = Modifier.fillMaxWidth(),
            factory = { ctx ->
                TextView(ctx).also { tv ->
                    tv.setTextColor(colorArgb)
                    tv.textSize = textSizeSp
                    tv.setTextIsSelectable(true)
                }
            },
            update = { tv ->
                tv.setTextColor(colorArgb)
                markwon.setMarkdown(tv, markdown)
            },
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PlanCard(
    confidence: String?,
    rootCause: String?,
    affectedFiles: List<String>,
    markdown: String,
) {
    val normalizedConfidence = confidence?.lowercase()?.takeIf { it.isNotBlank() && it != "unknown" && it != "none" }
    val normalizedRootCause = rootCause?.takeIf { it.isNotBlank() && it.lowercase() != "unknown" }

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (normalizedConfidence != null || normalizedRootCause != null || affectedFiles.isNotEmpty()) {
                if (normalizedConfidence != null) {
                    val (container, content) = when (normalizedConfidence) {
                        "high" -> MaterialTheme.colorScheme.primaryContainer to MaterialTheme.colorScheme.onPrimaryContainer
                        "low" -> MaterialTheme.colorScheme.errorContainer to MaterialTheme.colorScheme.onErrorContainer
                        else -> MaterialTheme.colorScheme.secondaryContainer to MaterialTheme.colorScheme.onSecondaryContainer
                    }
                    Card(
                        shape = RoundedCornerShape(50),
                        colors = CardDefaults.cardColors(containerColor = container),
                    ) {
                        Text(
                            "$normalizedConfidence confidence",
                            style = MaterialTheme.typography.labelSmall,
                            color = content,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                        )
                    }
                }
                if (normalizedRootCause != null) {
                    Text(normalizedRootCause, style = MaterialTheme.typography.bodyMedium)
                }
                if (affectedFiles.isNotEmpty()) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        affectedFiles.forEach { file ->
                            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
                                Text(
                                    file,
                                    style = MaterialTheme.typography.labelSmall,
                                    fontFamily = FontFamily.Monospace,
                                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 3.dp),
                                )
                            }
                        }
                    }
                }
                HorizontalDivider()
            }
            MarkdownText(markdown = markdown)
        }
    }
}

@Composable
private fun InvestigationProgress(
    activity: List<WsEvent.RemoteEditInvestigationActivity>,
    output: String,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (activity.isEmpty() && output.isBlank()) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                CircularProgressIndicator(modifier = Modifier.size(14.dp), strokeWidth = 2.dp)
                Text(
                    "Starting…",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        if (activity.isNotEmpty()) {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
                Column(modifier = Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        CircularProgressIndicator(modifier = Modifier.size(11.dp), strokeWidth = 2.dp)
                        Text(
                            "Activity",
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                    activity.takeLast(6).forEach { entry ->
                        Text(
                            if (entry.type == "thinking") "Thinking" else entry.label,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
        if (output.isNotBlank()) {
            Text("Plan (in progress)", style = MaterialTheme.typography.titleSmall)
            Card(modifier = Modifier.fillMaxWidth()) {
                Box(modifier = Modifier.padding(12.dp)) {
                    MarkdownText(markdown = stripFrontMatter(output))
                }
            }
        }
    }
}

private enum class RevisePlanView { REVISE, PLAN }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun RevisePlanControl(
    running: Boolean,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    report: ErrorReport? = null,
    investigationSettings: RemoteEditInvestigationSettings? = null,
    onSaveInvestigationSettings: ((RemoteEditInvestigationSettings) -> Unit)? = null,
    onRevise: (String) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    var notes by remember { mutableStateOf("") }
    var view by remember { mutableStateOf(RevisePlanView.REVISE) }
    var reviseModel by remember(open, investigationSettings) { mutableStateOf(investigationSettings?.model ?: "") }
    var showModelSheet by remember { mutableStateOf(false) }
    var showPromptSheet by remember { mutableStateOf(false) }
    val modelSheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val promptSheetState = rememberModalBottomSheetState()
    val scope = rememberCoroutineScope()
    val hasPlan = report?.investigationMarkdown?.isNotBlank() == true

    val models by WsRepository.models.collectAsState()
    val cliStatus by WsRepository.cliStatus.collectAsState()
    val promptEntries by WsRepository.promptEntries.collectAsState()

    fun close() {
        open = false
        notes = ""
        view = RevisePlanView.REVISE
    }

    if (open) {
        LaunchedEffect(Unit) {
            WsRepository.send("model:list", investigationSettings?.backend?.let { mapOf("backend" to it) } ?: emptyMap())
            WsRepository.listPrompts()
        }

        ModalBottomSheet(
            onDismissRequest = ::close,
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        ) {
            Column(modifier = Modifier.padding(horizontal = 20.dp).padding(bottom = 32.dp).imePadding()) {
                if (hasPlan) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        SegmentedButton(
                            text = "Revise plan",
                            selected = view == RevisePlanView.REVISE,
                            onClick = { view = RevisePlanView.REVISE },
                            modifier = Modifier.weight(1f),
                        )
                        SegmentedButton(
                            text = "View current plan",
                            selected = view == RevisePlanView.PLAN,
                            onClick = { view = RevisePlanView.PLAN },
                            modifier = Modifier.weight(1f),
                        )
                    }
                }

                if (view == RevisePlanView.PLAN && report != null) {
                    Column(
                        modifier = Modifier.fillMaxWidth().heightIn(max = 420.dp).verticalScroll(rememberScrollState()),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        PlanCard(
                            confidence = report.investigationConfidence,
                            rootCause = report.investigationRootCause,
                            affectedFiles = report.investigationAffectedFiles,
                            markdown = report.investigationMarkdown?.let { stripFrontMatter(it) } ?: "",
                        )
                    }
                    Row(modifier = Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.End) {
                        NexySecondaryButton(text = "Back to revise plan", onClick = { view = RevisePlanView.REVISE })
                    }
                } else {
                    Text(
                        "Revise plan",
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.padding(bottom = 16.dp),
                    )
                    OutlinedTextField(
                        value = notes,
                        onValueChange = { notes = it },
                        label = { Text("What should the plan do differently?") },
                        placeholder = { Text("e.g. Look in the android module instead") },
                        modifier = Modifier.fillMaxWidth(),
                        trailingIcon = {
                            Row {
                                IconButton(onClick = { showPromptSheet = true }) {
                                    Icon(Icons.Default.TextFields, contentDescription = "Insert prompt from library")
                                }
                                OnDeviceVoiceButton(
                                    onText = { text ->
                                        notes = if (notes.isBlank()) text else "${notes.trimEnd()} $text"
                                    },
                                )
                            }
                        },
                    )
                    if (investigationSettings != null && onSaveInvestigationSettings != null) {
                        Surface(
                            onClick = { showModelSheet = true },
                            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                            shape = MaterialTheme.shapes.small,
                            color = MaterialTheme.colorScheme.surfaceVariant,
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column {
                                    Text(
                                        "Model for this revision",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                    Text(
                                        activeModelLabel(reviseModel, models),
                                        style = MaterialTheme.typography.bodyMedium,
                                    )
                                }
                                Icon(Icons.Default.ChevronRight, contentDescription = null)
                            }
                        }
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
                        horizontalArrangement = Arrangement.End,
                    ) {
                        NexyGhostButton(text = "Cancel", onClick = ::close)
                        NexyPrimaryButton(
                            text = "Send revision",
                            onClick = {
                                if (investigationSettings != null && onSaveInvestigationSettings != null &&
                                    reviseModel != investigationSettings.model
                                ) {
                                    onSaveInvestigationSettings(investigationSettings.copy(model = reviseModel))
                                }
                                onRevise(notes)
                                close()
                            },
                        )
                    }
                }
            }
        }
    }

    if (showModelSheet) {
        ModalBottomSheet(
            onDismissRequest = { showModelSheet = false },
            sheetState = modelSheetState,
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            ModelPickerSheet(
                title = "Model for this revision",
                models = models,
                cliStatus = cliStatus,
                selectedModelId = reviseModel,
            ) { modelId ->
                reviseModel = modelId ?: "default"
                scope.launch { modelSheetState.hide() }.invokeOnCompletion { showModelSheet = false }
            }
        }
    }

    if (showPromptSheet) {
        ModalBottomSheet(
            onDismissRequest = { showPromptSheet = false },
            sheetState = promptSheetState,
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            PromptLibrarySheetContent(promptEntries = promptEntries) { body ->
                val separator = if (notes.isNotBlank() && !notes.endsWith("\n")) "\n" else ""
                notes += "$separator$body"
                scope.launch { promptSheetState.hide() }.invokeOnCompletion { showPromptSheet = false }
            }
        }
    }

    NexySecondaryButton(
        text = if (running) "Revising…" else "Revise plan",
        onClick = { open = true },
        enabled = enabled,
        modifier = modifier,
    )
}

@Composable
private fun SegmentedButton(
    text: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (selected) {
        NexyPrimaryButton(text = text, onClick = onClick, modifier = modifier)
    } else {
        NexySecondaryButton(text = text, onClick = onClick, modifier = modifier)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RemoteEditReportDetailScreen(
    reportId: String,
    onBack: () -> Unit,
    vm: RemoteEditViewModel = viewModel(),
) {
    val reports by vm.errorReports.collectAsState()
    val report = reports.find { it.id == reportId }
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val scrollState = androidx.compose.foundation.rememberScrollState()
    val sectionOffsets = remember { mutableStateMapOf<CodeChangeRequestPhase, Int>() }

    fun scrollToPhase(phase: CodeChangeRequestPhase) {
        val offset = sectionOffsets[phase] ?: return
        scope.launch { scrollState.animateScrollTo(offset) }
    }

    var stagedFiles by remember { mutableStateOf<List<RemoteEditStagedFileEntry>>(emptyList()) }
    var fixError by remember { mutableStateOf<String?>(null) }
    val expandedDiffs = remember { mutableStateMapOf<String, Boolean>() }
    val expandedFolders = remember { mutableStateMapOf<String, Boolean>() }
    val diffContents = remember { mutableStateMapOf<String, String?>() }
    var investigationRunning by remember { mutableStateOf(false) }
    var fixRunning by remember { mutableStateOf(false) }
    var showDeleteDialog by remember { mutableStateOf(false) }
    var showRollbackDialog by remember { mutableStateOf(false) }
    var investigationActivity by remember(reportId) { mutableStateOf<List<WsEvent.RemoteEditInvestigationActivity>>(emptyList()) }
    var investigationOutput by remember(reportId) { mutableStateOf("") }

    fun startInvestigation(notes: String? = null) {
        investigationRunning = true
        investigationActivity = emptyList()
        investigationOutput = ""
        WsRepository.startRemoteEditInvestigation(reportId, notes)
    }

    val investigationSettings by vm.investigationSettings.collectAsState()
    val isApplying by vm.isApplying.collectAsState()
    val verificationRunning by vm.verificationRunning.collectAsState()
    val verificationRuns by vm.verificationRuns.collectAsState()
    val gitPushRunning by vm.gitPushRunning.collectAsState()
    val recoveryRuns by vm.recoveryRuns.collectAsState()
    val latestVerificationRun = verificationRuns[reportId]?.firstOrNull()
    val latestRecoveryRun = recoveryRuns[reportId]?.firstOrNull()

    LaunchedEffect(reportId) {
        WsRepository.listStagedFiles(reportId)
        WsRepository.events.collect { event ->
            when {
                event is WsEvent.RemoteEditInvestigationActivity && event.reportId == reportId -> {
                    investigationActivity = (investigationActivity + event).takeLast(50)
                }
                event is WsEvent.RemoteEditInvestigationChunk && event.reportId == reportId -> {
                    investigationOutput += event.chunk
                }
                event is WsEvent.RemoteEditInvestigationDone && event.reportId == reportId -> {
                    investigationRunning = false
                    investigationActivity = emptyList()
                    investigationOutput = ""
                    vm.refresh(report?.projectId.orEmpty())
                }
                event is WsEvent.RemoteEditFixDone && event.reportId == reportId -> {
                    fixRunning = false
                    stagedFiles = event.stagedFiles
                    fixError = event.error
                    vm.refresh(report?.projectId.orEmpty())
                }
                event is WsEvent.RemoteEditStagedFiles && event.reportId == reportId -> {
                    stagedFiles = event.stagedFiles
                }
                event is WsEvent.RemoteEditStagedDiff && event.reportId == reportId -> {
                    diffContents[event.relativePath] = event.hunksJson?.let { renderDiffHunks(it) }
                }
                else -> {}
            }
        }
    }

    LaunchedEffect(Unit) {
        vm.actionResults.collect { result ->
            if (result.reportId == reportId || result.reportId.isBlank()) {
                scope.launch { snackbarHostState.showSnackbar(result.message) }
                if (result.reportId == reportId) vm.refresh(report?.projectId.orEmpty())
            }
        }
    }

    if (showDeleteDialog) {
        NexyConfirmDialog(
            title = "Delete change request?",
            message = "\"${report?.title ?: "This request"}\" and all associated data will be permanently deleted.",
            confirmLabel = "Delete",
            destructive = true,
            onConfirm = {
                showDeleteDialog = false
                vm.deleteReport(reportId)
                onBack()
            },
            onDismiss = { showDeleteDialog = false },
        )
    }

    if (showRollbackDialog) {
        NexyConfirmDialog(
            title = "Undo this change?",
            message = "This restores the affected files to their state before this change was applied. This cannot be undone.",
            confirmLabel = "Undo",
            destructive = true,
            onConfirm = {
                showRollbackDialog = false
                latestRecoveryRun?.recoveryId?.takeIf { it.isNotBlank() }?.let { vm.requestRollback(it) }
            },
            onDismiss = { showRollbackDialog = false },
        )
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            NexyTopAppBar(
                titleContent = { Text(report?.title ?: "Change request") },
                onBack = onBack,
                actions = {
                    IconButton(onClick = { showDeleteDialog = true }) {
                        Icon(Icons.Default.Delete, contentDescription = "Delete")
                    }
                },
            )
        },
    ) { padding ->
        if (report == null) {
            Box(modifier = Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Text(
                    "Change request not found.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            return@Scaffold
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(scrollState)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            // Status row
            val phase = deriveCodeChangePhase(
                report = report,
                verificationStatus = latestVerificationRun?.status,
                committed = false,
            )
            PhaseStepper(phase = phase, onStepClick = ::scrollToPhase)
            Text(
                CODE_CHANGE_PHASE_GUIDANCE.getValue(phase),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            // Description
            if (report.description.isNotBlank()) {
                val context = LocalContext.current
                val clipboardManager = remember(context) { context.getSystemService(ClipboardManager::class.java) }
                var descMenuExpanded by remember { mutableStateOf(false) }
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                ) {
                    Box(
                        modifier = Modifier.combinedClickable(
                            onClick = {},
                            onLongClick = { descMenuExpanded = true },
                        ),
                    ) {
                        DropdownMenu(expanded = descMenuExpanded, onDismissRequest = { descMenuExpanded = false }) {
                            DropdownMenuItem(
                                text = { Text("Copy") },
                                onClick = {
                                    descMenuExpanded = false
                                    copyMessage(clipboardManager, report.description)
                                },
                            )
                        }
                        Text(
                            text = report.description,
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.padding(12.dp),
                        )
                    }
                }
            }

            val planFailed = report.investigationRootCause == "investigation_failed"
            // A plan that finished but hasn't been reviewed yet stays at status "investigating"
            // (see persistResult() in investigator.ts) — it is NOT still running in that case.
            val planAwaitingReview = report.status == "investigating" &&
                !report.investigationMarkdown.isNullOrBlank() && !investigationRunning
            val planHasNoAffectedFiles = planAwaitingReview && report.investigationAffectedFiles.isEmpty()

            Box(
                modifier = Modifier.onGloballyPositioned {
                    sectionOffsets[CodeChangeRequestPhase.INVESTIGATING] = it.positionInParent().y.toInt()
                },
            ) {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
            // Live planning progress — activity feed + streamed output, shown while the LLM is
            // actively working so the user has clear on-screen confirmation planning is running
            // (mirrors desktop's CodeChangeInvestigationSection.tsx).
            if (investigationRunning) {
                InvestigationProgress(activity = investigationActivity, output = investigationOutput)
            }
            // Planning failure
            if (planFailed) {
                Text("Planning failed", style = MaterialTheme.typography.titleSmall)
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
                ) {
                    Text(
                        text = report.investigationMarkdown
                            ?.substringAfter("# Planning failed\n\n", "")
                            ?.trim()
                            ?.ifBlank { "The plan could not be generated." }
                            ?: "The plan could not be generated.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        modifier = Modifier.padding(12.dp),
                    )
                }
            }

            report.investigationMarkdown?.takeIf { it.isNotBlank() && !planFailed }?.let { markdown ->
                Text("Plan", style = MaterialTheme.typography.titleSmall)
                PlanCard(
                    confidence = report.investigationConfidence,
                    rootCause = report.investigationRootCause,
                    affectedFiles = report.investigationAffectedFiles,
                    markdown = stripFrontMatter(markdown),
                )
            }

            if (planAwaitingReview) {
                if (planHasNoAffectedFiles) {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
                    ) {
                        Column(modifier = Modifier.padding(12.dp)) {
                            Text(
                                "This plan didn't identify any files to change",
                                style = MaterialTheme.typography.titleSmall,
                                color = MaterialTheme.colorScheme.onErrorContainer,
                            )
                            Text(
                                "Generating a patch from this plan will fail. Revise it or reject it.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onErrorContainer,
                            )
                        }
                    }
                }
                var reviewAction by remember(reportId) { mutableStateOf<String?>(null) }
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        NexyPrimaryButton(
                            text = if (reviewAction == "accept") "Accepting…" else "Accept",
                            onClick = {
                                reviewAction = "accept"
                                WsRepository.setRemoteEditReportStatus(reportId, "investigated", report.projectId.orEmpty())
                            },
                            enabled = reviewAction == null && !planHasNoAffectedFiles,
                            modifier = Modifier.weight(1f),
                        )
                        NexyDangerButton(
                            text = if (reviewAction == "reject") "Rejecting…" else "Reject",
                            onClick = {
                                reviewAction = "reject"
                                WsRepository.setRemoteEditReportStatus(reportId, "rejected", report.projectId.orEmpty())
                            },
                            enabled = reviewAction == null,
                            modifier = Modifier.weight(1f),
                        )
                    }
                    RevisePlanControl(
                        running = investigationRunning,
                        enabled = reviewAction == null,
                        modifier = Modifier.fillMaxWidth(),
                        report = report,
                        investigationSettings = investigationSettings,
                        onSaveInvestigationSettings = { vm.saveInvestigationSettings(it) },
                        onRevise = { notes ->
                            reviewAction = "revise"
                            startInvestigation(notes)
                        },
                    )
                }
            }

            if (report.status == "rejected") {
                var rejectedReviewAction by remember(reportId) { mutableStateOf<String?>(null) }
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
                ) {
                    Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            "Plan rejected. Revise it with new instructions, delete this request, or accept the plan as-is if you've changed your mind.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onErrorContainer,
                        )
                        RevisePlanControl(
                            running = investigationRunning,
                            enabled = rejectedReviewAction == null,
                            modifier = Modifier.fillMaxWidth(),
                            report = report,
                            investigationSettings = investigationSettings,
                            onSaveInvestigationSettings = { vm.saveInvestigationSettings(it) },
                            onRevise = { notes ->
                                rejectedReviewAction = "revise"
                                startInvestigation(notes)
                            },
                        )
                        NexySecondaryButton(
                            text = if (rejectedReviewAction == "accept") "Accepting…" else "Accept anyway",
                            onClick = {
                                rejectedReviewAction = "accept"
                                WsRepository.setRemoteEditReportStatus(reportId, "investigated", report.projectId.orEmpty())
                            },
                            enabled = rejectedReviewAction == null && report.investigationAffectedFiles.isNotEmpty(),
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
            }
            }
            }

            // Action buttons — investigate / fix
            if (report.status in listOf("open", "investigating", "investigated") && report.fixStatus !in listOf("staged", "applied")) {
                if ((report.status == "open" || report.status == "investigating") && !planAwaitingReview) {
                    // report.status == "investigating" with investigationRunning still false and no
                    // markdown yet means this request was already planning before this screen was
                    // opened (e.g. started, then the user navigated back and returned) — the backend
                    // call is still in flight either way.
                    val resumedInBackground = !investigationRunning && report.status == "investigating"
                    val isPlanning = investigationRunning || resumedInBackground
                    if (resumedInBackground) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            CircularProgressIndicator(modifier = Modifier.size(14.dp), strokeWidth = 2.dp)
                            Text(
                                "Planning is still running in the background.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    if (!isPlanning) {
                        PlanningSettingsSection(
                            settings = investigationSettings,
                            onSave = { vm.saveInvestigationSettings(it) },
                        )
                    }
                    NexyPrimaryButton(
                        text = if (isPlanning) "Planning…" else if (report.investigationRootCause != null) "Retry" else "Plan change",
                        onClick = { startInvestigation() },
                        enabled = !isPlanning,
                        modifier = Modifier.fillMaxWidth(),
                        leadingIcon = Icons.Default.Search,
                    )
                }
                if (report.status == "investigated") {
                    if (report.fixStatus == "failed" && fixError != null) {
                        Text(
                            fixError ?: "",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                    if (report.fixStatus == "failed") {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            RevisePlanControl(
                                running = investigationRunning,
                                enabled = !fixRunning && !investigationRunning,
                                modifier = Modifier.fillMaxWidth(),
                                report = report,
                                investigationSettings = investigationSettings,
                                onSaveInvestigationSettings = { vm.saveInvestigationSettings(it) },
                                onRevise = { notes -> startInvestigation(notes) },
                            )
                            NexyPrimaryButton(
                                text = if (fixRunning) "Generating…" else "Regenerate patch",
                                onClick = {
                                    fixRunning = true
                                    WsRepository.startRemoteEditFix(reportId)
                                },
                                enabled = !fixRunning && !investigationRunning,
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                    } else {
                        NexyPrimaryButton(
                            text = if (fixRunning) "Generating patch…" else "Generate staged patch",
                            onClick = {
                                fixRunning = true
                                WsRepository.startRemoteEditFix(reportId)
                            },
                            enabled = !fixRunning,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
            }

            // Per-file diff cards
            if (stagedFiles.isNotEmpty()) {
                Box(
                    modifier = Modifier.onGloballyPositioned {
                        sectionOffsets[CodeChangeRequestPhase.PATCH_READY] = it.positionInParent().y.toInt()
                    },
                ) {
                Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text("Staged patch", style = MaterialTheme.typography.titleSmall)
                val fileTree = remember(stagedFiles) { buildFileTree(stagedFiles) }
                val isFlat = fileTree.none { it is FileTreeNode.Folder }

                fun onToggleDiff(path: String) {
                    val nowExpanded = expandedDiffs[path] != true
                    expandedDiffs[path] = nowExpanded
                    if (nowExpanded && diffContents[path] == null) {
                        WsRepository.getStagedDiff(reportId, path)
                    }
                }

                if (isFlat) {
                    fileTree.forEach { node ->
                        val leaf = node as FileTreeNode.FileLeaf
                        FileLeafRow(
                            node = leaf,
                            expanded = expandedDiffs[leaf.relativePath] == true,
                            diffContent = diffContents[leaf.relativePath],
                            onToggle = { onToggleDiff(leaf.relativePath) },
                        )
                    }
                } else {
                    FileTreeView(
                        nodes = fileTree,
                        expandedFolders = expandedFolders,
                        expandedDiffs = expandedDiffs,
                        diffContents = diffContents,
                        onToggleDiff = ::onToggleDiff,
                    )
                }

                if (report.fixStatus == "staged") {
                    NexyPrimaryButton(
                        text = if (isApplying == reportId) "Applying…" else "Apply patch",
                        onClick = { vm.applyPatch(reportId) },
                        enabled = isApplying == null,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                }
                }
            }

            // Verification
            if (report.fixStatus == "applied") {
                Box(
                    modifier = Modifier.onGloballyPositioned {
                        sectionOffsets[CodeChangeRequestPhase.APPLIED] = it.positionInParent().y.toInt()
                    },
                ) {
                Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text("Verification", style = MaterialTheme.typography.titleSmall)
                NexyPrimaryButton(
                    text = if (verificationRunning == reportId) "Verifying…" else "Run verification",
                    onClick = { vm.startVerification(reportId) },
                    enabled = verificationRunning == null,
                    modifier = Modifier.fillMaxWidth(),
                )
                latestVerificationRun?.let { run ->
                    Text(
                        text = "Last run: ${run.status}${run.error?.let { " — $it" } ?: ""}",
                        style = MaterialTheme.typography.bodySmall,
                        color = if (run.status == "success") {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.error
                        },
                    )
                }

                if (latestVerificationRun?.status == "success") {
                    Text("Git", style = MaterialTheme.typography.titleSmall)
                    NexySecondaryButton(
                        text = if (gitPushRunning == reportId) "Pushing…" else "Push",
                        onClick = { vm.pushFix(reportId) },
                        enabled = gitPushRunning == null,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                if (latestVerificationRun?.status == "failed") {
                    RevisePlanControl(
                        running = investigationRunning,
                        enabled = !investigationRunning,
                        modifier = Modifier.fillMaxWidth(),
                        report = report,
                        investigationSettings = investigationSettings,
                        onSaveInvestigationSettings = { vm.saveInvestigationSettings(it) },
                        onRevise = { notes -> startInvestigation(notes) },
                    )
                }

                // Undo
                latestRecoveryRun?.let { run ->
                    if (run.status == "rolled-back") {
                        Text("Undo", style = MaterialTheme.typography.titleSmall)
                        Text(
                            text = "Change undone. Files restored to their state before this change was applied.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    } else if (run.status in listOf("prepared", "reloading", "confirmed")) {
                        Text("Undo", style = MaterialTheme.typography.titleSmall)
                        NexyDangerButton(
                            text = "Undo this change",
                            onClick = { showRollbackDialog = true },
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
                }
                }
            }
        }
    }
}

private val PLANNING_BACKENDS = listOf(
    "byok" to "BYOK",
    "claude-cli" to "Claude CLI",
    "codex-cli" to "Codex CLI",
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PlanningSettingsSection(
    settings: RemoteEditInvestigationSettings?,
    onSave: (RemoteEditInvestigationSettings) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    var backend by remember(settings) { mutableStateOf(settings?.backend ?: "byok") }
    var model by remember(settings) { mutableStateOf(settings?.model ?: "") }
    var retryLimit by remember(settings) { mutableStateOf((settings?.retryLimit ?: 1).toString()) }
    var autoApproveTools by remember(settings) { mutableStateOf(settings?.autoApproveTools ?: false) }
    var backendMenuExpanded by remember { mutableStateOf(false) }

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth().clickable { expanded = !expanded },
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text("Planning settings", style = MaterialTheme.typography.titleSmall)
                Icon(
                    if (expanded) Icons.Default.ExpandMore else Icons.Default.ChevronRight,
                    contentDescription = if (expanded) "Collapse" else "Expand",
                )
            }
            if (expanded) {
                ExposedDropdownMenuBox(
                    expanded = backendMenuExpanded,
                    onExpandedChange = { backendMenuExpanded = it },
                ) {
                    OutlinedTextField(
                        value = PLANNING_BACKENDS.firstOrNull { it.first == backend }?.second ?: backend,
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("Backend") },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = backendMenuExpanded) },
                        modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
                    )
                    ExposedDropdownMenu(
                        expanded = backendMenuExpanded,
                        onDismissRequest = { backendMenuExpanded = false },
                    ) {
                        PLANNING_BACKENDS.forEach { (value, label) ->
                            DropdownMenuItem(
                                text = { Text(label) },
                                onClick = { backend = value; backendMenuExpanded = false },
                            )
                        }
                    }
                }
                OutlinedTextField(
                    value = model,
                    onValueChange = { model = it },
                    label = { Text("Model") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = retryLimit,
                    onValueChange = { retryLimit = it.filter(Char::isDigit) },
                    label = { Text("Retries") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(
                    modifier = Modifier.fillMaxWidth().clickable { autoApproveTools = !autoApproveTools },
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Checkbox(checked = autoApproveTools, onCheckedChange = { autoApproveTools = it })
                    Text(
                        "Auto-approve planning tools",
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.padding(top = 12.dp),
                    )
                }
                NexySecondaryButton(
                    text = "Save settings",
                    onClick = {
                        onSave(
                            RemoteEditInvestigationSettings(
                                backend = backend,
                                model = model,
                                retryLimit = retryLimit.toIntOrNull()?.coerceIn(0, 5) ?: 1,
                                autoApproveTools = autoApproveTools,
                            ),
                        )
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}
