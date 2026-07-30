import { describe, expect, it } from 'vitest'
import { activityContext } from '../components/ActivityFeedModal'

describe('activityContext', () => {
  it('fills missing server metadata from the renderer conversation catalogs', () => {
    const result = activityContext(
      {
        conversationId: 'conversation-1',
        detail: 'Using tools',
      },
      {
        conversations: [{
          id: 'conversation-1',
          title: 'Fix the activity feed',
          agent_id: 'agent-1',
          project_id: 'project-1',
          created_at: 1,
          updated_at: 2,
        }],
        projects: [{
          id: 'project-1',
          name: 'Nexy',
          color: 'blue',
          created_at: 1,
          updated_at: 2,
        }],
        agents: [{
          id: 'agent-1',
          name: 'UI Engineer',
          icon: '🎨',
          systemPrompt: '',
          temperature: 0,
          maxTokens: 1,
          contextDirectories: [],
          contextFiles: [],
          mcpServers: [],
          agenticMode: false,
          tools: {
            fileEdit: { enabled: false, approval: 'always-ask', instructions: '' },
            terminal: { enabled: false, approval: 'always-ask', instructions: '' },
            webFetch: { enabled: false, approval: 'always-ask', instructions: '' },
          },
          responseFormat: 'default',
        }],
      },
    )

    expect(result).toEqual([
      { label: 'Chat', value: 'Fix the activity feed' },
      { label: 'Project', value: 'Nexy' },
      { label: 'Agent', value: 'UI Engineer' },
      { label: 'Details', value: 'Using tools' },
    ])
  })
})
