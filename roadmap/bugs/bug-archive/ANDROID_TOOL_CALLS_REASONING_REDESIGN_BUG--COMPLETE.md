# Android Tool Calls & Reasoning Display Redesign Plan

**Status:** Design Phase  
**Priority:** High (UX/Design Improvement)  
**Platform:** Android App  
**Related Milestone:** UI Unification

---

## 📋 Executive Summary

Currently, the Android app displays tool calls and reasoning/thinking content in an inefficient and cluttered manner:
- **Tool Calls:** Display full data object structures, overwhelming users with unnecessary details
- **Reasoning/Thinking:** Displays all content in a single monolithic block, making it hard to follow reasoning progression

This plan outlines a comprehensive redesign to:
1. **Tool Calls:** Format and display only relevant data fields with clean, user-friendly presentation
2. **Reasoning/Thinking:** Display each thinking block separately as it's generated, maintaining sequential flow and clarity

---

## 🎯 Design Objectives

### Primary Goals
1. **Improve User Experience** - Make tool calls and reasoning easy to understand at a glance
2. **Maintain Sequential Flow** - Show thinking/reasoning as it's generated, not as a bulk block
3. **Reduce Cognitive Load** - Hide unnecessary technical details from end users
4. **Ensure Consistency** - Align with desktop app and overall UI unification goals
5. **Preserve Debugging Capability** - Allow power users to expand/view full object data if needed

### Secondary Goals
1. Improve visual hierarchy and scanability
2. Maintain performance with streaming content
3. Ensure responsive design on various Android screen sizes
4. Support both light and dark themes

---

## 📊 Current State Analysis

### Tool Calls Display Issues
**Current Behavior:**
```
{
  "tool_name": "search",
  "parameters": {
    "query": "...",
    "limit": 10,
    "filters": {
      "date_from": "2026-01-01",
      "date_to": "2026-06-26",
      "category": "news",
      "language": "en",
      "sort_order": "relevance"
    },
    "advanced_options": {
      "exact_match": false,
      "include_variations": true
    }
  },
  "execution_id": "exec_123456",
  "timestamp": "2026-06-26T14:23:45Z"
}
```

**Problems:**
- ❌ Entire JSON structure shown to users
- ❌ Redundant metadata (execution_id, timestamp)
- ❌ Nested objects create visual clutter
- ❌ No distinction between essential and optional parameters
- ❌ No user-friendly labels or descriptions

### Reasoning/Thinking Display Issues

**Current Behavior:**
```
[THINKING BLOCK]
Let me analyze this problem. First, I need to understand the user's intent. 
The user is asking about X. This relates to previous context about Y. 
I should search for Z. But before that, let me consider if there's a cached result. 
Actually, I think I should try approach A first. Let me trace through the logic...
[END THINKING BLOCK]
```

**Problems:**
- ❌ All content in one large block
- ❌ Hard to follow reasoning progression
- ❌ No visual separation between distinct thought streams
- ❌ Streaming updates cause entire block to re-render
- ❌ No indication of when new thoughts are being added

---

## 🎨 Proposed Design Solutions

### Tool Calls Redesign

#### **Strategy 1: Collapsible Summary Card**

**Default View (Collapsed):**
```
┌─────────────────────────────┐
│ 🔍 Search                   │
│ Query: "climate change"     │
│ Results: 10                 │
│ [Tap to expand]             │
└─────────────────────────────┘
```

**Expanded View:**
```
┌─────────────────────────────┐
│ 🔍 Search Tool              │ ✕
├─────────────────────────────┤
│ Query: "climate change"     │
│ Limit: 10 results           │
│ Filters:                    │
│  • Date: 2026-01-01 → ...   │
│  • Category: news           │
│  • Language: English        │
│ Status: ✓ Completed         │
│ Duration: 245ms             │
│ [Show Raw JSON]             │
└─────────────────────────────┘
```

#### **Strategy 2: Key-Value Mapping**

Map full object structures to user-friendly field names:

```
Tool Call Mapping:
{
  "parameters": {
    "query" → "Search Query"
    "limit" → "Max Results"
    "filters.category" → "Category"
    "filters.date_from" → "From Date"
  }
  // Hide: execution_id, timestamp, advanced_options
}
```

#### **Implementation Details**

**Files to Modify:**
- `android/app/src/main/kotlin/com/nexy/chat/components/ToolCallDisplay.kt` (or similar)
- `android/app/src/main/res/layout/tool_call_card.xml` (or Compose equivalent)
- `android/app/src/main/kotlin/com/nexy/chat/utils/ToolCallFormatter.kt` (new file)

**Key Components:**
1. **ToolCallFormatter** - Converts tool call objects to displayable data
2. **ToolCallCardView** - Renders the card with collapse/expand functionality
3. **FieldMappingConfig** - Configurable mapping of object fields to display labels

**Pseudo-code:**
```kotlin
// ToolCallFormatter.kt
class ToolCallFormatter {
  fun formatToolCall(toolCall: ToolCall): DisplayedToolCall {
    return DisplayedToolCall(
      icon = getIconForTool(toolCall.name),
      title = toolCall.name,
      summary = extractKeySummary(toolCall.parameters),
      expandedData = filterRelevantFields(toolCall.parameters),
      rawData = toolCall // For power users
    )
  }
  
  private fun filterRelevantFields(params: Map): Map {
    // Only include non-null, user-facing fields
    return params.filterKeys { 
      it in DISPLAYABLE_FIELDS 
    }
  }
}
```

---

### Reasoning/Thinking Redesign

#### **Strategy 1: Streaming Thought Blocks**

**Current (Problem):**
```
[ONE BIG THINKING BLOCK - everything in here]
```

**Proposed (Solution):**
```
💭 Thinking Block #1
├─ Let me analyze this problem...
└─ [COMPLETED]

💭 Thinking Block #2
├─ I need to search for more information...
└─ [IN PROGRESS - 2s ago]

💭 Thinking Block #3
├─ Based on the search results...
└─ [STREAMING - 0s ago]
```

#### **Strategy 2: Progressive Disclosure**

Each thinking block shows:
- **Status indicator** (✓ Complete, ⏳ In Progress, ➕ New)
- **Time indicator** (when block started/completed)
- **Content preview** (first 2-3 lines)
- **Expand button** (view full thinking)
- **Timestamp** (optional, for debugging)

#### **Strategy 3: Visual Distinction**

```
┌─────────────────────────────┐
│ 💭 Reasoning Block 1        │ ✓
├─────────────────────────────┤
│ Let me break down this       │
│ problem step by step...      │
│                             │
│ [Expand]                    │
└─────────────────────────────┘

┌─────────────────────────────┐
│ 💭 Reasoning Block 2        │ ⏳
├─────────────────────────────┤
│ Now I need to consider the   │
│ implications of...          │
│                             │
│ [Auto-expand as new]        │
└─────────────────────────────┘
```

#### **Implementation Details**

**Files to Modify:**
- `android/app/src/main/kotlin/com/nexy/chat/components/ReasoningDisplay.kt` (new file)
- `android/app/src/main/kotlin/com/nexy/chat/viewmodels/ChatViewModel.kt` (update state management)
- `android/app/src/main/res/layout/reasoning_block.xml` (or Compose equivalent)

**Key Components:**
1. **ReasoningBlockState** - Tracks individual thinking block state
2. **ReasoningBlockView** - Renders individual thinking block
3. **ReasoningStreamManager** - Manages streaming updates and new block creation

**Pseudo-code:**
```kotlin
// ReasoningBlockState.kt
data class ReasoningBlockState(
  val id: String = UUID.randomUUID().toString(),
  val content: String = "",
  val status: ReasoningStatus = IN_PROGRESS,
  val startTime: Long = System.currentTimeMillis(),
  val endTime: Long? = null,
  val isExpanded: Boolean = false
)

enum class ReasoningStatus {
  COMPLETED, IN_PROGRESS, NEW
}

// ReasoningStreamManager.kt
class ReasoningStreamManager {
  private val reasoningBlocks = MutableList<ReasoningBlockState>()
  
  fun addReasoningChunk(chunk: String) {
    if (shouldCreateNewBlock(chunk)) {
      reasoningBlocks.add(ReasoningBlockState())
    }
    
    // Append to current block
    reasoningBlocks.last().content += chunk
    
    // Notify UI to re-render
    updateUI(reasoningBlocks)
  }
  
  private fun shouldCreateNewBlock(chunk: String): Boolean {
    // Detect when a new thinking block begins
    // Could be based on: newlines, markers, or timing
    return chunk.startsWith("[NEW_THINKING]") || 
           currentBlockLength() > MAX_BLOCK_LENGTH
  }
}
```

---

## 🔧 Implementation Phases

### Phase 1: Design & Specification (1 week)
**Deliverables:**
- [ ] Finalized UI mockups for tool calls (collapsed & expanded states)
- [ ] Finalized UI mockups for reasoning blocks
- [ ] Color scheme and styling guide
- [ ] Animation/transition specifications
- [ ] Accessibility guidelines (WCAG compliance)

**Activities:**
1. Create detailed Figma/mockup designs
2. Define tool call field mapping for all supported tools
3. Document thought block detection logic
4. Review with design and product teams

---

### Phase 2: Backend Integration (1 week)
**Deliverables:**
- [ ] ToolCallFormatter utility class
- [ ] ReasoningStreamManager class
- [ ] Updated state management for streaming updates
- [ ] Field mapping configuration

**Activities:**
1. Implement ToolCallFormatter with full test coverage
2. Create ReasoningStreamManager to handle block separation
3. Update ChatViewModel to use new formatters
4. Add logging for debugging

---

### Phase 3: UI Component Development (2 weeks)
**Deliverables:**
- [ ] ToolCallCardView component
- [ ] ReasoningBlockView component
- [ ] Animation/transition implementations
- [ ] Responsive layout for various screen sizes

**Activities:**
1. Implement collapsible tool call cards
2. Implement streaming reasoning blocks with proper state management
3. Add expand/collapse animations
4. Test on multiple screen sizes (phone, tablet)

---

### Phase 4: Integration & Testing (1 week)
**Deliverables:**
- [ ] Integration with existing chat window
- [ ] End-to-end testing framework
- [ ] Performance benchmarking
- [ ] Regression testing

**Activities:**
1. Integrate new components into ChatWindow
2. Test with real orchestration responses
3. Performance test with long reasoning chains
4. Verify streaming behavior

---

### Phase 5: Refinement & Polish (1 week)
**Deliverables:**
- [ ] Theme variations (light/dark mode)
- [ ] Accessibility audit and fixes
- [ ] Documentation and code comments
- [ ] Ready for release

**Activities:**
1. Apply theme variations
2. Run accessibility checker
3. Polish animations and transitions
4. Final QA testing

---

## 🧪 Testing Strategy

### Unit Tests
- [ ] ToolCallFormatter correctly maps all tool types
- [ ] ReasoningStreamManager correctly identifies block boundaries
- [ ] State updates trigger UI re-renders
- [ ] Streaming content is properly buffered

### Integration Tests
- [ ] Tool calls render correctly in chat window
- [ ] Reasoning blocks update correctly during streaming
- [ ] Multiple concurrent tool calls display correctly
- [ ] Expand/collapse functionality works smoothly

### Manual/UI Tests
- **Tool Calls:**
  - [ ] Tap tool call card → expands to show details
  - [ ] Tap "Show Raw JSON" → displays full object
  - [ ] Scroll through long parameter lists → smooth scrolling
  - [ ] Test with 2-5 concurrent tool calls

- **Reasoning/Thinking:**
  - [ ] Each new thinking block appears separately
  - [ ] Content streams smoothly into each block
  - [ ] Completed blocks stay visible, new blocks auto-expand
  - [ ] Tap block to expand → shows full content
  - [ ] Test with 3-5 consecutive reasoning blocks

### Performance Tests
- [ ] Render 10+ reasoning blocks without lag
- [ ] Stream 1000+ characters of reasoning smoothly
- [ ] Memory usage remains stable during long chats
- [ ] No frame drops during animations

### Accessibility Tests
- [ ] Screen reader can read tool calls correctly
- [ ] Screen reader can read reasoning blocks in sequence
- [ ] Color contrast meets WCAG AA standards
- [ ] Touch targets are >= 48dp

---

## 🎨 Design System Requirements

### Tool Call Card
```
Dimensions:
- Min Height: 64dp (collapsed)
- Max Height: unlimited (expanded)
- Margin: 8dp
- Padding: 16dp
- Corner Radius: 8dp

Colors:
- Background: Surface color
- Border: Outline color
- Text: On-Surface color
- Icon: Primary color

Typography:
- Title: Headline Small (14sp)
- Field Label: Label Medium (12sp)
- Field Value: Body Medium (14sp)
```

### Reasoning Block
```
Dimensions:
- Min Height: 48dp (collapsed)
- Max Height: unlimited (expanded)
- Margin: 8dp
- Padding: 12dp
- Corner Radius: 8dp

Colors:
- Background: Surface Variant color
- Border: Outline Variant color
- Text: On-Surface Variant color
- Status Icon: Secondary color

Typography:
- Header: Title Small (14sp)
- Content: Body Small (13sp)
- Status: Label Small (11sp)
```

---

## 📈 Success Metrics

### Qualitative Metrics
- [ ] Users find tool calls easier to understand (user feedback)
- [ ] Users appreciate sequential reasoning display (user feedback)
- [ ] Designers approve design consistency (design review)
- [ ] No regression in other features (QA sign-off)

### Quantitative Metrics
- [ ] Render time for tool calls: < 200ms
- [ ] Render time for reasoning blocks: < 100ms per block
- [ ] Memory overhead: < 5MB for 10+ blocks
- [ ] 60 FPS animations throughout
- [ ] Test coverage: > 85%

---

## 🔄 UI Unification Alignment

This redesign ensures:
1. **Consistency** - Tool calls and reasoning display the same across desktop and Android
2. **Accessibility** - Meets WCAG guidelines on both platforms
3. **Design System** - Uses unified color palette and typography
4. **Responsive** - Works on all screen sizes (phone, tablet, desktop)
5. **Performance** - Optimized for both mobile and desktop

---

## 📝 Related Plans

- [[ANDROID_TOOL_CALLS_REASONING_DISPLAY_BUG_FIX_PLAN.md]] - Bug fix for flickering/disappearing content
- [[UI_UNIFICATION_PLAN.md]] - Overall UI consistency milestone

---

## ⏱️ Timeline Summary

| Phase | Duration | Start | End |
|-------|----------|-------|-----|
| Phase 1: Design | 1 week | Week 1 | Week 1 |
| Phase 2: Backend | 1 week | Week 2 | Week 2 |
| Phase 3: UI Development | 2 weeks | Week 3 | Week 4 |
| Phase 4: Integration & Testing | 1 week | Week 5 | Week 5 |
| Phase 5: Polish | 1 week | Week 6 | Week 6 |
| **Total** | **6 weeks** | | |

---

## 👥 Resource Requirements

**Team:**
- 1 UI/UX Designer (Phase 1, 3, 5)
- 2 Android Engineers (Phase 2-5)
- 1 QA Engineer (Phase 4-5)
- 1 Design System Lead (Phase 1, 3)

**Tools:**
- Figma (design mockups)
- Android Studio (development)
- Firebase/LogCat (debugging)
- Performance Profiler (benchmarking)

---

## ⚠️ Risks & Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| Complex streaming logic causes regressions | Medium | High | Comprehensive test coverage + staged rollout |
| Performance issues with large reasoning chains | Medium | Medium | Implement virtualization/pagination if needed |
| Design inconsistency between Android & desktop | Low | High | Design system validation from Day 1 |
| WebView bridge issues with Android | Low | High | Early prototype testing on real devices |

---

## 📋 Checklist for Implementation

- [ ] Design mockups approved by stakeholders
- [ ] Field mapping configuration complete
- [ ] ToolCallFormatter fully tested
- [ ] ReasoningStreamManager fully tested
- [ ] UI components built and styled
- [ ] Integration tests passing
- [ ] Manual UI tests on real devices
- [ ] Accessibility audit completed
- [ ] Performance benchmarks meet targets
- [ ] Documentation complete
- [ ] Code review approved
- [ ] Staged rollout completed

---

## 📞 Next Steps

1. **Get Design Review** - Share mockups with design and product teams
2. **Finalize Field Mapping** - Document which fields to show for each tool
3. **Prototype Streaming** - Build quick prototype of reasoning block streaming
4. **Setup Test Environment** - Prepare devices/emulators for testing
5. **Begin Phase 1** - Start design finalization

