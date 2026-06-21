# Roadmap: Sidebar Navigation Revamp

## Context

The sidebar currently has two visually and structurally inconsistent zones:

**Zone 1 (clean):** Four `NavButton` entries — Self-Heal, Feature Generator, Artifacts, Report a Bug — rendered as full-width ghost buttons with an icon and label, consistent style, no inline content.

**Zone 2 (messy):** Everything below that is a different paradigm entirely — "No project" is a custom-styled `div`, "Projects" is a collapsible section header with an inline preview list of up to 5 projects, "No agent" is another custom `div`, "Agents" is another collapsible section header with an inline preview list plus "New Agent" and "Import" buttons at the bottom, and below that a "Chats" section header with an inline conversation history list grouped by date. All of these use bespoke styling that doesn't match the `NavButton` pattern.

The fix: replace Zone 2 entirely with `NavButton`-style entries for Projects, Agents, and Chats. Each button opens the corresponding `SectionPane` (which already exists and is fully functional — `ProjectsPane`, `AgentsPane`, `ChatsPane`). The inline preview lists, sentinels, collapsible chevrons, and section headers are all removed from the sidebar. The `SectionPane` slide-out panels become the *only* place these lists appear.

---

## Milestone X — Sidebar Zone 2 Cleanup

### X.1 — Replace Projects section with a NavButton

**Remove from Sidebar.tsx (lines ~471–600):**
- "No project" sentinel `<div>`
- The `projectsOpen` state variable and its setter
- The entire Projects collapsible section: header, chevron, inline project list, "…and X more" button

**Add:**
```tsx
<NavButton
  icon={<FolderOpen className="w-3.5 h-3.5" />}
  label="Projects"
  onClick={() => openSectionPane('projects')}
  ariaLabel="Open projects"
/>
```

The `activeProjectId` filter for conversation scoping still works — it's driven by `selectProject()` calls inside `ProjectsPane`, not by the sidebar inline list. No behaviour change, just the inline list is gone from the sidebar.

### X.2 — Replace Agents section with a NavButton

**Remove from Sidebar.tsx (lines ~603–727):**
- "No agent" sentinel `<div>`
- The `agentsOpen` state variable and its setter
- The entire Agents collapsible section: header, chevron, inline agent list, "…and X more" button, "New Agent" button, "Import" button

**Add:**
```tsx
<NavButton
  icon={<Bot className="w-3.5 h-3.5" />}
  label="Agents"
  onClick={() => openSectionPane('agents')}
  ariaLabel="Open agents"
/>
```

"New Agent" and "Import" already exist inside `AgentsPane` — no functionality is lost.

### X.3 — Replace Chats section with a NavButton

**Remove from Sidebar.tsx (lines ~730–815):**
- The `chatsOpen` state variable and its setter
- The entire Chats collapsible section: header, chevron, date-grouped conversation list, pinned section, "…and X more" button, import button, loading skeleton, empty state

**Add:**
```tsx
<NavButton
  icon={<MessageSquare className="w-3.5 h-3.5" />}
  label="Chats"
  onClick={() => openSectionPane('chats')}
  ariaLabel="Open chat history"
/>
```

All conversation management (rename, pin, delete, move to project) is already fully implemented inside `ChatsPane`. The `renderConversation` helper and `groupByDate` helper in `Sidebar.tsx` can be deleted once this section is removed.

### X.4 — Clean up orphaned state and imports

Remove from `Sidebar.tsx`:
- `projectsOpen` / `setProjectsOpen` state
- `agentsOpen` / `setAgentsOpen` state  
- `chatsOpen` / `setChatsOpen` state
- The `renderConversation` function and `groupByDate` function (already live in `ChatsPane`)
- The `DateGroup` interface (already defined in `ChatsPane`)
- Store selectors no longer needed: `conversationsLoading`, `historyProjectId`, `setHistoryProjectId`, `agentsLoading`, `unreadConversationIds`, `filteredConversations` computation, `hiddenConvCount` computation, `selectAgent`, `openEditAgent`, `openCreateAgent`, `importAgent`, `setHistoryAgentId`, `setConversationProject`, `selectProject`, `openEditProject`, `addAgentToProject`, `catalogModels`, `setShowNewProjectForm`, `projectAgents`
- Lucide imports no longer needed: `ChevronDown`, `ChevronRight`, `Folder`, `FolderOpen` (the FolderOpen is reused in the NavButton — keep it), `MessageSquare` (reused — keep it)
- The drag-and-drop handlers on the project/agent rows (already in `SectionPane` components)

Keep:
- `newChat` button and `SearchBar` at the top
- All four existing `NavButton` entries (Self-Heal, Feature Generator, Artifacts, Report a Bug)
- The three new `NavButton` entries (Projects, Agents, Chats)
- Footer (auth status, settings)
- `openSectionPane` / `setSectionPane` / `activeSectionPane` selectors (still needed to open panes)

### X.5 — Visual separator between tool buttons and navigation buttons

The four tool buttons (Self-Heal through Report a Bug) and the three navigation buttons (Projects, Agents, Chats) are logically distinct groups. Add a thin `<hr>` divider between them, matching the existing `border-gray-200 dark:border-gray-700/80` style used elsewhere in the sidebar.

### X.6 — Active state on nav buttons

`NavButton` currently has no active/selected visual state. Add an `active` prop:

```tsx
function NavButton({ ..., active }: { ..., active?: boolean }) {
  return (
    <Button
      variant="ghost"
      className={`w-full justify-start px-3 py-1.5 ${active ? 'bg-gray-100 dark:bg-gray-800' : ''}`}
      ...
    >
```

Pass `active={activeSectionPane === 'projects'}` etc. to each nav button so the open pane is visually highlighted — consistent with the existing blue-text highlight the old section headers used.

---

## Affected Files

- `src/renderer/components/Sidebar.tsx` — primary change: remove ~350 lines of Zone 2, replace with ~15 lines of NavButtons
- No changes needed to `SectionPane.tsx`, `ProjectsPane.tsx`, `AgentsPane.tsx`, `ChatsPane.tsx` — these already do the right thing

---

## Verification

1. `npm run typecheck` — must stay clean
2. Sidebar renders: New Chat, SearchBar, Self-Heal, Feature Generator, Artifacts, Report a Bug, [divider], Projects, Agents, Chats, footer
3. Clicking Projects opens the Projects `SectionPane` (full list, create/edit project actions all work)
4. Clicking Agents opens the Agents `SectionPane` (full list, New Agent, Import all work)
5. Clicking Chats opens the Chats `SectionPane` (full history, rename/pin/delete/move all work)
6. The active pane button is visually highlighted
7. No inline preview lists, sentinels, or chevrons remain in the sidebar
8. `npm test` — suite stays green
