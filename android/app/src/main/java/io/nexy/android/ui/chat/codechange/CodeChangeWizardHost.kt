package io.nexy.android.ui.chat.codechange

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.Conversation

/**
 * Main wizard host for Code Changes feature.
 * Renders as a dedicated conversation surface with the 6-step flow.
 */
@Composable
fun CodeChangeWizardHost(
    conversation: Conversation,
    wsRepository: WsRepository,
) {
    val factory = remember { CodeChangeViewModelFactory(wsRepository, conversation) }
    val viewModel: CodeChangeViewModel = viewModel(factory = factory)
    val state by viewModel.codeChangeState.collectAsState()

    LazyColumn(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item {
            CodeChangeStepStepper(currentStep = state.currentStep)
        }

        item {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp),
            ) {
                when (state.currentStep) {
                    "describe" -> DescribeStep(
                        state = state,
                        onDescriptionChanged = { /* Update internal state */ },
                        onSubmit = viewModel::submitDescription,
                    )

                    "plan-review" -> PlanReviewStep(
                        state = state,
                        onAccept = viewModel::acceptPlanAndExecute,
                        onRevise = viewModel::revisePlan,
                    )

                    "executing" -> ExecutingStep(state = state)

                    "verifying" -> VerifyingStep(state = state)

                    "final-review" -> FinalReviewStep(
                        state = state,
                        onPush = viewModel::pushChanges,
                    )

                    "attention" -> PlanReviewStep(
                        state = state,
                        onAccept = viewModel::acceptPlanAndExecute,
                        onRevise = viewModel::revisePlan,
                    )

                    else -> Text("Unknown step: ${state.currentStep}")
                }
            }
        }

        item {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                // Revision history if step is "plan-review" or "attention"
                if (state.currentStep in listOf("plan-review", "attention")) {
                    // Show revision history (would fetch from state)
                }

                // Footer with step info
                Text(
                    text = "Code Changes — Conversation ID: ${conversation.id}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

/**
 * Step indicator showing all 6 steps with current progress.
 */
@Composable
fun CodeChangeStepStepper(currentStep: String) {
    // Pill 0 ("Repo") is always considered complete: this composable only mounts inside an
    // existing code-change conversation, meaning repo selection already happened before the
    // conversation/report were created (see startCodeChangeConversation on the backend).
    val currentIndex = when (currentStep) {
        "describe" -> 1
        "plan-review", "attention" -> 2
        "executing" -> 3
        "verifying" -> 4
        "final-review" -> 5
        else -> 1
    }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(12.dp),
        shape = MaterialTheme.shapes.medium,
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = "Code Changes Progress",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
            )

            // 6-pill stepper
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(32.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                repeat(6) { index ->
                    val isCompleted = index < currentIndex
                    val isCurrent = index == currentIndex

                    Card(
                        modifier = Modifier
                            .weight(1f)
                            .height(32.dp)
                            .background(
                                when {
                                    isCurrent -> MaterialTheme.colorScheme.primary
                                    isCompleted -> MaterialTheme.colorScheme.primaryContainer
                                    else -> MaterialTheme.colorScheme.surfaceVariant
                                }
                            ),
                        shape = MaterialTheme.shapes.small,
                    ) {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 4.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.Center,
                        ) {
                            Text(
                                text = "${index + 1}",
                                style = MaterialTheme.typography.labelSmall,
                                color = when {
                                    isCurrent -> MaterialTheme.colorScheme.onPrimary
                                    isCompleted -> MaterialTheme.colorScheme.onPrimaryContainer
                                    else -> MaterialTheme.colorScheme.onSurfaceVariant
                                },
                                fontWeight = if (isCurrent) FontWeight.Bold else FontWeight.Normal,
                            )
                        }
                    }
                }
            }

            // Step labels
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                listOf(
                    "Repo",
                    "Describe",
                    "Plan",
                    "Execute",
                    "Verify",
                    "Review",
                ).forEach { label ->
                    Text(
                        text = label,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

// Factory for ViewModels
class CodeChangeViewModelFactory(
    private val wsRepository: WsRepository,
    private val conversation: Conversation,
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        @Suppress("UNCHECKED_CAST")
        return CodeChangeViewModel(wsRepository, conversation) as T
    }
}
