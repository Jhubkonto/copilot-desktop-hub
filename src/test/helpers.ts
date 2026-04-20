/**
 * Shared test helpers and factories.
 */
import { render, type RenderOptions } from '@testing-library/react'
import { type ReactElement } from 'react'

/**
 * Flush microtask queue — useful after state updates.
 */
export function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Wait for N ms — useful for debounce tests.
 */
export function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Create a mock conversation object.
 */
export function createMockConversation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conv-test-1',
    agent_id: null,
    title: 'Test Conversation',
    created_at: Date.now(),
    updated_at: Date.now(),
    ...overrides
  }
}

/**
 * Create a mock message object.
 */
export function createMockMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-test-1',
    role: 'user' as const,
    content: 'Hello, world!',
    timestamp: Date.now(),
    ...overrides
  }
}

/**
 * Create a mock agent config.
 */
export function createMockAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-test-1',
    name: 'Test Agent',
    icon: '🤖',
    systemPrompt: 'You are a test agent.',
    model: 'gpt-4',
    temperature: 0.7,
    maxTokens: 4096,
    contextDirectories: [],
    contextFiles: [],
    mcpServers: [],
    agenticMode: false,
    tools: { fileEdit: false, terminal: false, webFetch: false },
    responseFormat: 'default' as const,
    isDefault: false,
    ...overrides
  }
}

/**
 * Render helper — just re-exports render for now, can wrap with providers later.
 */
export function renderComponent(ui: ReactElement, options?: RenderOptions) {
  return render(ui, options)
}
