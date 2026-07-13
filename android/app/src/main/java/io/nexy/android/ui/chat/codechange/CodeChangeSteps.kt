package io.nexy.android.ui.chat.codechange

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Divider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/**
 * Step 1: Workspace & Repo Selection
 */
@Composable
fun WorkspaceStep(
    state: CodeChangeState,
    onRepoSelected: (String) -> Unit,
    onNextStep: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp)
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        StepHeader(
            step = 1,
            title = "Select Repository",
            description = "Choose which repository to modify"
        )

        if (state.workspace?.repos.isNullOrEmpty()) {
            if (state.isLoading) {
                CircularProgressIndicator(modifier = Modifier.align(Alignment.CenterHorizontally))
                Text("Discovering repositories...", style = MaterialTheme.typography.bodyMedium)
            } else if (state.error != null) {
                Surface(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(8.dp),
                    color = MaterialTheme.colorScheme.errorContainer,
                    shape = MaterialTheme.shapes.small,
                ) {
                    Text(
                        text = state.error,
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        modifier = Modifier.padding(12.dp),
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            } else {
                Text("No repositories found in workspace", style = MaterialTheme.typography.bodyMedium)
            }
        } else {
            Text("Available repositories:", fontWeight = FontWeight.SemiBold)
            state.workspace?.repos?.forEach { repo ->
                RepoListItem(
                    repo = repo,
                    isSelected = state.selectedRepoPath == repo.relativePath,
                    onSelect = { onRepoSelected(it) }
                )
            }
        }

        Spacer(modifier = Modifier.height(8.dp))
        Button(
            onClick = onNextStep,
            modifier = Modifier.fillMaxWidth(),
            enabled = state.selectedRepoPath.isNotEmpty() && !state.isLoading,
        ) {
            Text("Continue to Description")
        }
    }
}

/**
 * Step 2: Describe Changes
 */
@Composable
fun DescribeStep(
    state: CodeChangeState,
    onDescriptionChanged: (String) -> Unit,
    onSubmit: (String) -> Unit,
) {
    var description by remember { mutableStateOf(state.description) }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp)
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        StepHeader(
            step = 2,
            title = "Describe Changes",
            description = "What code changes do you want to make?"
        )

        OutlinedTextField(
            value = description,
            onValueChange = {
                description = it
                onDescriptionChanged(it)
            },
            label = { Text("Describe the changes") },
            modifier = Modifier
                .fillMaxWidth()
                .height(200.dp),
            minLines = 6,
            maxLines = Int.MAX_VALUE,
        )

        if (state.error != null) {
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(8.dp),
                color = MaterialTheme.colorScheme.errorContainer,
                shape = MaterialTheme.shapes.small,
            ) {
                Text(
                    text = state.error,
                    color = MaterialTheme.colorScheme.onErrorContainer,
                    modifier = Modifier.padding(12.dp),
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }

        Button(
            onClick = { onSubmit(description) },
            modifier = Modifier.fillMaxWidth(),
            enabled = description.isNotEmpty() && !state.isLoading,
        ) {
            if (state.isLoading) {
                CircularProgressIndicator(modifier = Modifier.padding(end = 8.dp))
                Text("Analyzing...")
            } else {
                Text("Generate Plan")
            }
        }
    }
}

/**
 * Step 3: Review & Approve Plan
 */
@Composable
fun PlanReviewStep(
    state: CodeChangeState,
    onAccept: () -> Unit,
    onRevise: (String) -> Unit,
) {
    var revisionNotes by remember { mutableStateOf("") }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp)
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        StepHeader(
            step = 3,
            title = "Review Plan",
            description = "Review the proposed changes"
        )

        // Display the plan markdown
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(8.dp),
            color = MaterialTheme.colorScheme.surfaceVariant,
            shape = MaterialTheme.shapes.small,
        ) {
            Text(
                text = state.plan.ifBlank { "Plan will appear here..." },
                modifier = Modifier.padding(12.dp),
                style = MaterialTheme.typography.bodySmall,
            )
        }

        if (state.error != null) {
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(8.dp),
                color = MaterialTheme.colorScheme.errorContainer,
                shape = MaterialTheme.shapes.small,
            ) {
                Text(
                    text = state.error,
                    color = MaterialTheme.colorScheme.onErrorContainer,
                    modifier = Modifier.padding(12.dp),
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }

        Divider()

        Text("Actions:", fontWeight = FontWeight.SemiBold)

        Button(
            onClick = onAccept,
            modifier = Modifier.fillMaxWidth(),
            enabled = !state.isLoading,
        ) {
            if (state.isLoading) {
                CircularProgressIndicator(modifier = Modifier.padding(end = 8.dp))
                Text("Executing...")
            } else {
                Text("Accept & Execute")
            }
        }

        OutlinedTextField(
            value = revisionNotes,
            onValueChange = { revisionNotes = it },
            label = { Text("Revision notes (optional)") },
            modifier = Modifier.fillMaxWidth(),
        )

        OutlinedButton(
            onClick = { onRevise(revisionNotes) },
            modifier = Modifier.fillMaxWidth(),
            enabled = revisionNotes.isNotEmpty() && !state.isLoading,
        ) {
            Text("Revise Plan")
        }
    }
}

/**
 * Step 4: Executing
 */
@Composable
fun ExecutingStep(
    state: CodeChangeState,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        StepHeader(
            step = 4,
            title = "Executing Changes",
            description = "Applying code changes to your repository"
        )

        Spacer(modifier = Modifier.height(32.dp))
        CircularProgressIndicator()
        Spacer(modifier = Modifier.height(16.dp))
        Text("Generating patch and applying changes...", style = MaterialTheme.typography.bodyMedium)

        if (state.error != null) {
            Spacer(modifier = Modifier.height(16.dp))
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(8.dp),
                color = MaterialTheme.colorScheme.errorContainer,
                shape = MaterialTheme.shapes.small,
            ) {
                Text(
                    text = state.error,
                    color = MaterialTheme.colorScheme.onErrorContainer,
                    modifier = Modifier.padding(12.dp),
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}

/**
 * Step 5: Verifying
 */
@Composable
fun VerifyingStep(
    state: CodeChangeState,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        StepHeader(
            step = 5,
            title = "Verifying Changes",
            description = "Running verification tests"
        )

        Spacer(modifier = Modifier.height(32.dp))
        CircularProgressIndicator()
        Spacer(modifier = Modifier.height(16.dp))
        Text("Running verification commands...", style = MaterialTheme.typography.bodyMedium)

        if (state.error != null) {
            Spacer(modifier = Modifier.height(16.dp))
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(8.dp),
                color = MaterialTheme.colorScheme.errorContainer,
                shape = MaterialTheme.shapes.small,
            ) {
                Text(
                    text = state.error,
                    color = MaterialTheme.colorScheme.onErrorContainer,
                    modifier = Modifier.padding(12.dp),
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}

/**
 * Step 6: Final Review & Push
 */
@Composable
fun FinalReviewStep(
    state: CodeChangeState,
    onPush: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp)
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        StepHeader(
            step = 6,
            title = "Final Review",
            description = "Changes have been applied and verified"
        )

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(
                imageVector = Icons.Filled.CheckCircle,
                contentDescription = "Completed",
                tint = MaterialTheme.colorScheme.primary,
            )
            Text("Changes committed locally", style = MaterialTheme.typography.bodyMedium)
        }

        if (state.error != null) {
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(8.dp),
                color = MaterialTheme.colorScheme.errorContainer,
                shape = MaterialTheme.shapes.small,
            ) {
                Text(
                    text = state.error,
                    color = MaterialTheme.colorScheme.onErrorContainer,
                    modifier = Modifier.padding(12.dp),
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }

        if (state.successMessage != null) {
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(8.dp),
                color = MaterialTheme.colorScheme.primaryContainer,
                shape = MaterialTheme.shapes.small,
            ) {
                Text(
                    text = state.successMessage,
                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                    modifier = Modifier.padding(12.dp),
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }

        Button(
            onClick = onPush,
            modifier = Modifier.fillMaxWidth(),
            enabled = !state.isLoading,
        ) {
            if (state.isLoading) {
                CircularProgressIndicator(modifier = Modifier.padding(end = 8.dp))
                Text("Pushing...")
            } else {
                Text("Push to Remote")
            }
        }
    }
}

// Helper composables

@Composable
private fun StepHeader(
    step: Int,
    title: String,
    description: String,
) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            text = "Step $step",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.primary,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = title,
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = description,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun RepoListItem(
    repo: RepoInfo,
    isSelected: Boolean,
    onSelect: (String) -> Unit,
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        color = if (isSelected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface,
        shape = MaterialTheme.shapes.small,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    text = repo.relativePath.ifBlank { "root" },
                    fontWeight = FontWeight.SemiBold,
                    style = MaterialTheme.typography.bodyMedium,
                )
                Text(
                    text = "Branch: ${repo.branch}${if (repo.dirty) " (modified)" else ""}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            TextButton(
                onClick = { onSelect(repo.relativePath) },
            ) {
                Text(if (isSelected) "Selected" else "Select")
            }
        }
    }
}
