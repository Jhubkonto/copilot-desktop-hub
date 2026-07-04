package io.nexy.android.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import io.nexy.android.data.model.RemoteEditStagedFileEntry

sealed class FileTreeNode {
    abstract val name: String

    data class Folder(
        override val name: String,
        val children: List<FileTreeNode>,
    ) : FileTreeNode()

    data class FileLeaf(
        override val name: String,
        val relativePath: String,
        val diffLineCount: Int,
    ) : FileTreeNode()
}

private fun countFiles(node: FileTreeNode): Int = when (node) {
    is FileTreeNode.FileLeaf -> 1
    is FileTreeNode.Folder -> node.children.sumOf { countFiles(it) }
}

/**
 * Groups flat relative paths (always forward-slash separated — these come from the Electron/Node
 * staging logic as project-relative paths, never raw OS paths) into a nested directory tree.
 * Folders sort before files, alphabetical within each group. No synthetic top-level "root" node
 * is returned — callers render the returned list directly.
 */
fun buildFileTree(entries: List<RemoteEditStagedFileEntry>): List<FileTreeNode> {
    val root = TrieNode()
    for (entry in entries) {
        val segments = entry.relativePath.split("/").filter { it.isNotEmpty() }
        if (segments.isEmpty()) continue
        var current = root
        for ((index, segment) in segments.withIndex()) {
            val isLeaf = index == segments.lastIndex
            if (isLeaf) {
                current.children.getOrPut(segment) { TrieNode() }.entry = entry
            } else {
                current = current.children.getOrPut(segment) { TrieNode() }
            }
        }
    }
    return root.toNodes()
}

private class TrieNode {
    val children = LinkedHashMap<String, TrieNode>()
    var entry: RemoteEditStagedFileEntry? = null

    fun toNodes(): List<FileTreeNode> {
        val folders = mutableListOf<FileTreeNode.Folder>()
        val files = mutableListOf<FileTreeNode.FileLeaf>()
        for ((name, child) in children) {
            val leafEntry = child.entry
            if (leafEntry != null && child.children.isEmpty()) {
                files.add(FileTreeNode.FileLeaf(name, leafEntry.relativePath, leafEntry.diffLineCount))
            } else {
                folders.add(FileTreeNode.Folder(name, child.toNodes()))
            }
        }
        folders.sortBy { it.name }
        files.sortBy { it.name }
        return folders + files
    }
}

@Composable
fun FileTreeView(
    nodes: List<FileTreeNode>,
    expandedFolders: MutableMap<String, Boolean>,
    expandedDiffs: Map<String, Boolean>,
    diffContents: Map<String, String?>,
    onToggleDiff: (relativePath: String) -> Unit,
    modifier: Modifier = Modifier,
    depth: Int = 0,
    parentPath: String = "",
) {
    Column(modifier = modifier.fillMaxWidth()) {
        nodes.forEach { node ->
            val fullPath = if (parentPath.isEmpty()) node.name else "$parentPath/${node.name}"
            when (node) {
                is FileTreeNode.Folder -> {
                    val expanded = expandedFolders[fullPath] ?: true
                    FolderRow(
                        node = node,
                        expanded = expanded,
                        depth = depth,
                        onToggle = { expandedFolders[fullPath] = !expanded },
                    )
                    AnimatedVisibility(visible = expanded, enter = expandVertically(), exit = shrinkVertically()) {
                        FileTreeView(
                            nodes = node.children,
                            expandedFolders = expandedFolders,
                            expandedDiffs = expandedDiffs,
                            diffContents = diffContents,
                            onToggleDiff = onToggleDiff,
                            depth = depth + 1,
                            parentPath = fullPath,
                        )
                    }
                }
                is FileTreeNode.FileLeaf -> {
                    FileLeafRow(
                        node = node,
                        depth = depth,
                        expanded = expandedDiffs[node.relativePath] == true,
                        diffContent = diffContents[node.relativePath],
                        onToggle = { onToggleDiff(node.relativePath) },
                    )
                }
            }
        }
    }
}

@Composable
private fun FolderRow(
    node: FileTreeNode.Folder,
    expanded: Boolean,
    depth: Int,
    onToggle: () -> Unit,
) {
    val fileCount = countFiles(node)
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onToggle),
        color = androidx.compose.ui.graphics.Color.Transparent,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = (depth * 16).dp, top = 8.dp, bottom = 8.dp, end = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(
                Icons.Default.Folder,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(end = 2.dp),
            )
            Text(
                node.name,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.weight(1f),
            )
            Text(
                if (fileCount == 1) "1 file" else "$fileCount files",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Icon(
                if (expanded) Icons.Default.ExpandMore else Icons.Default.ChevronRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
fun FileLeafRow(
    node: FileTreeNode.FileLeaf,
    expanded: Boolean,
    diffContent: String?,
    onToggle: () -> Unit,
    depth: Int = 0,
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = (depth * 16).dp, bottom = 4.dp)
            .clickable(onClick = onToggle),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = node.name,
                style = MaterialTheme.typography.bodySmall,
                fontFamily = FontFamily.Monospace,
                modifier = Modifier.weight(1f),
            )
            if (node.diffLineCount > 0) {
                Text(
                    text = "${node.diffLineCount} lines changed",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(end = 4.dp),
                )
            }
            Icon(
                if (expanded) Icons.Default.ExpandMore else Icons.Default.ChevronRight,
                contentDescription = null,
            )
        }
        AnimatedVisibility(visible = expanded, enter = expandVertically(), exit = shrinkVertically()) {
            if (diffContent == null) {
                Text(
                    "Loading diff…",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(12.dp),
                )
            } else {
                NexyDiffContent(diffContent)
            }
        }
    }
}
