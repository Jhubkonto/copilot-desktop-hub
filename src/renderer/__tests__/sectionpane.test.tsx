import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SectionPane } from "../components/SectionPane";
import { createMockAppStore, setupStoreMock } from "../../test/mocks/store";
import { setupMockApi } from "../../test/mocks/api";
import type { ProjectAgent } from "../store/types";

const { useAppStore } = vi.hoisted(() => ({ useAppStore: vi.fn() }));

vi.mock("../store/app-store", () => ({ useAppStore }));

// ResizeHandle requires pointer events — stub it out
vi.mock("../components/ResizeHandle", () => ({
  ResizeHandle: () => null,
}));

// ProjectSettingsPanel — stub so we can assert it renders without full setup
vi.mock("../components/ProjectSettingsPanel", () => ({
  ProjectSettingsPanel: ({
    projectId,
    onClose,
  }: {
    projectId: string;
    onClose: () => void;
  }) => (
    <div data-testid="project-settings-panel" data-project-id={projectId}>
      <button onClick={onClose}>Close settings</button>
    </div>
  ),
}));

let mockStore: ReturnType<typeof createMockAppStore>;

beforeEach(() => {
  vi.clearAllMocks();
  mockStore = createMockAppStore({
    activeSectionPane: "projects" as const,
    projects: [
      {
        id: "p1",
        name: "My Project",
        color: "blue",
        created_at: 0,
        default_model: null,
      },
    ],
    conversations: [],
    agents: [],
    agentsLoading: false,
    activeProjectId: null,
    activeAgentId: null,
    currentConversationId: null,
  });
  setupStoreMock(useAppStore, mockStore);
});

describe("SectionPane", () => {
  it("renders the projects header when section is projects", () => {
    render(<SectionPane section="projects" />);
    expect(
      screen.getByRole("heading", { name: /projects/i }),
    ).toBeInTheDocument();
  });

  it("renders the agents header when section is agents", () => {
    render(<SectionPane section="agents" />);
    expect(
      screen.getByRole("heading", { name: /agents/i }),
    ).toBeInTheDocument();
  });

  it("renders the chats header when section is chats", () => {
    render(<SectionPane section="chats" />);
    expect(
      screen.getByRole("heading", { name: /all chats/i }),
    ).toBeInTheDocument();
  });

  it("calls setSectionPane with the current section when close button is clicked", async () => {
    render(<SectionPane section="projects" />);
    const closeBtn = screen.getByRole("button", {
      name: /close projects panel/i,
    });
    await userEvent.click(closeBtn);
    expect(mockStore.setSectionPane).toHaveBeenCalledWith("projects");
  });

  it("shows project list in projects pane", () => {
    render(<SectionPane section="projects" />);
    expect(screen.getByText("My Project")).toBeInTheDocument();
  });

  it('shows "No agents configured" message when agents list is empty', () => {
    render(<SectionPane section="agents" />);
    expect(screen.getByText(/no agents configured/i)).toBeInTheDocument();
  });

  it('shows "No conversations yet" message when conversations list is empty', () => {
    render(<SectionPane section="chats" />);
    expect(screen.getByText(/no conversations yet/i)).toBeInTheDocument();
  });
});

// ── Agent membership UI ──────────────────────────────────────────

describe("SectionPane — Agent membership (G4)", () => {
  const MEMBER: ProjectAgent = {
    agentId: "agent-1",
    agentName: "Tester Bot",
    agentIcon: "🤖",
    isPrimary: true,
    sortOrder: 0,
  };

  let mockStore: ReturnType<typeof createMockAppStore>;

  beforeEach(() => {
    setupMockApi();
    vi.clearAllMocks();
    mockStore = createMockAppStore({
      activeSectionPane: "projects" as const,
      projects: [
        {
          id: "p1",
          name: "My Project",
          color: "blue",
          created_at: 0,
          default_model: null,
        },
      ],
      projectAgents: { p1: [MEMBER] },
      conversations: [],
      agents: [
        {
          id: "agent-2",
          config_json: JSON.stringify({
            name: "Helper",
            icon: "🛠️",
            model: "gpt-4o",
            systemPrompt: "",
            temperature: 0.7,
            maxTokens: 4096,
            contextDirectories: [],
            contextFiles: [],
            mcpServers: [],
            agenticMode: false,
            tools: {},
            responseFormat: "default",
          }),
          is_default: 0,
          created_at: 0,
          updated_at: 0,
        },
      ],
      agentsLoading: false,
      activeProjectId: null,
      activeAgentId: null,
      currentConversationId: null,
    });
    setupStoreMock(useAppStore, mockStore);
  });

  it("g4-1: renders agent member inside the project card", () => {
    render(<SectionPane section="projects" />);
    expect(screen.getByText("Tester Bot")).toBeInTheDocument();
  });

  it("g4-2: primary member shows the primary badge", () => {
    render(<SectionPane section="projects" />);
    expect(screen.getByText(/primary/i)).toBeInTheDocument();
  });

  it("g4-3: remove button calls removeAgentFromProject", async () => {
    render(<SectionPane section="projects" />);
    const removeBtn = screen.getByRole("button", {
      name: /remove tester bot from project/i,
    });
    await userEvent.click(removeBtn);
    expect(mockStore.removeAgentFromProject).toHaveBeenCalledWith(
      "p1",
      "agent-1",
    );
  });

  it("g4-4: agent cards in AgentsPane have data-agent-id attribute", () => {
    render(<SectionPane section="agents" />);
    const card = document.querySelector('[data-agent-id="agent-2"]');
    expect(card).not.toBeNull();
  });

  it("g4-5: agent cards in AgentsPane are draggable", () => {
    render(<SectionPane section="agents" />);
    const card = document.querySelector('[data-agent-id="agent-2"]');
    expect(card).toHaveAttribute("draggable", "true");
  });

  it("g4-6: dragStart on agent card sets agent-id in dataTransfer", () => {
    render(<SectionPane section="agents" />);
    const card = document.querySelector(
      '[data-agent-id="agent-2"]',
    ) as HTMLElement;
    expect(card).not.toBeNull();
    const dt = { setData: vi.fn(), effectAllowed: "" };
    fireEvent.dragStart(card, { dataTransfer: dt });
    expect(dt.setData).toHaveBeenCalledWith("agent-id", "agent-2");
  });
});

// ── Agent Deletion UI ─────────────────────────────────────────────

describe("SectionPane — Agent deletion (I6)", () => {
  const NON_DEFAULT_AGENT = {
    id: "agent-del",
    name: "Deletable Agent",
    icon: "🗑",
    model: "gpt-4o",
    systemPrompt: "",
    temperature: 0.7,
    maxTokens: 4096,
    contextDirectories: [] as string[],
    contextFiles: [] as string[],
    mcpServers: [] as string[],
    agenticMode: false,
    tools: {
      fileEdit: {
        enabled: false,
        approval: "always-ask" as const,
        instructions: "",
      },
      terminal: {
        enabled: false,
        approval: "always-ask" as const,
        instructions: "",
      },
      webFetch: {
        enabled: false,
        approval: "always-ask" as const,
        instructions: "",
      },
    },
    responseFormat: "default",
    isDefault: false,
  };

  const DEFAULT_AGENT = {
    id: "agent-default",
    name: "Default Agent",
    icon: "🤖",
    model: "gpt-4o",
    systemPrompt: "",
    temperature: 0.7,
    maxTokens: 4096,
    contextDirectories: [] as string[],
    contextFiles: [] as string[],
    mcpServers: [] as string[],
    agenticMode: false,
    tools: {
      fileEdit: {
        enabled: false,
        approval: "always-ask" as const,
        instructions: "",
      },
      terminal: {
        enabled: false,
        approval: "always-ask" as const,
        instructions: "",
      },
      webFetch: {
        enabled: false,
        approval: "always-ask" as const,
        instructions: "",
      },
    },
    responseFormat: "default",
    isDefault: true,
  };

  let mockStore: ReturnType<typeof createMockAppStore>;

  beforeEach(() => {
    setupMockApi();
    vi.clearAllMocks();
    mockStore = createMockAppStore({
      activeSectionPane: "agents" as const,
      projects: [],
      conversations: [],
      agents: [NON_DEFAULT_AGENT],
      agentsLoading: false,
      activeProjectId: null,
      activeAgentId: null,
      currentConversationId: null,
    });
    setupStoreMock(useAppStore, mockStore);
  });

  it("i6-1: delete button is present on non-default agent card", () => {
    render(<SectionPane section="agents" />);
    const btn = screen.getByRole("button", { name: /delete deletable agent/i });
    expect(btn).toBeInTheDocument();
  });

  it("i6-2: clicking delete button calls deleteAgent store action", async () => {
    render(<SectionPane section="agents" />);
    const btn = screen.getByRole("button", { name: /delete deletable agent/i });
    await userEvent.click(btn);
    expect(mockStore.deleteAgent).toHaveBeenCalledWith("agent-del");
  });

  it("i6-3: delete button is present on default agent card", () => {
    mockStore = createMockAppStore({
      activeSectionPane: "agents" as const,
      projects: [],
      conversations: [],
      agents: [DEFAULT_AGENT],
      agentsLoading: false,
      activeProjectId: null,
      activeAgentId: null,
      currentConversationId: null,
    });
    setupStoreMock(useAppStore, mockStore);
    render(<SectionPane section="agents" />);
    const btn = screen.getByRole("button", { name: /delete default agent/i });
    expect(btn).toBeInTheDocument();
  });
});

// ── Project settings panel (J5/J6 UI wiring) ─────────────────────

describe("SectionPane — Project settings panel (J5)", () => {
  let mockStore: ReturnType<typeof createMockAppStore>;

  beforeEach(() => {
    setupMockApi();
    vi.clearAllMocks();
    mockStore = createMockAppStore({
      activeSectionPane: "projects" as const,
      projects: [
        {
          id: "p1",
          name: "Alpha Project",
          color: "blue",
          created_at: 0,
          default_model: null,
        },
      ],
      projectConfigs: {
        p1: {
          instructions: "Be concise.",
          rootDirectory: "",
          instructionMode: "prepend",
          instructionsEnabled: true,
          variables: [],
          orchestrationEnabled: false,
          maxDelegationDepth: 3,
          showTeamActivity: false,
        },
      },
      conversations: [],
      agents: [],
      agentsLoading: false,
      activeProjectId: null,
      activeAgentId: null,
      currentConversationId: null,
    });
    setupStoreMock(useAppStore, mockStore);
  });

  it("j5-1: project settings panel is not rendered inline in SectionPane", () => {
    render(<SectionPane section="projects" />);
    // Panel is now rendered in App.tsx — SectionPane only calls openEditProject
    expect(
      screen.queryByTestId("project-settings-panel"),
    ).not.toBeInTheDocument();
  });

  it("j5-2: clicking the settings gear calls openEditProject with the project id", async () => {
    render(<SectionPane section="projects" />);
    const settingsBtn = screen.getByRole("button", {
      name: /edit project settings/i,
    });
    await userEvent.click(settingsBtn);
    expect(mockStore.openEditProject).toHaveBeenCalledWith("p1");
  });

  it("j5-3: clicking the settings gear calls openEditProject with the correct id for each project", async () => {
    render(<SectionPane section="projects" />);
    const settingsBtn = screen.getByRole("button", {
      name: /edit project settings/i,
    });
    await userEvent.click(settingsBtn);
    expect(mockStore.openEditProject).toHaveBeenCalledTimes(1);
    expect(mockStore.openEditProject).toHaveBeenCalledWith("p1");
  });
});

// ── Intuitive agent-to-project assignment ─────────────────────────

describe("SectionPane — Agent-to-project assignment (L)", () => {
  const AGENT_A = {
    id: "a1",
    name: "Alpha Bot",
    icon: "🔵",
    model: "gpt-4o",
    systemPrompt: "",
    temperature: 0.7,
    maxTokens: 4096,
    contextDirectories: [] as string[],
    contextFiles: [] as string[],
    mcpServers: [] as string[],
    agenticMode: false,
    tools: {
      fileEdit: {
        enabled: false,
        approval: "always-ask" as const,
        instructions: "",
      },
      terminal: {
        enabled: false,
        approval: "always-ask" as const,
        instructions: "",
      },
      webFetch: {
        enabled: false,
        approval: "always-ask" as const,
        instructions: "",
      },
    },
    responseFormat: "default",
    isDefault: false,
  };
  const AGENT_B = {
    id: "a2",
    name: "Beta Bot",
    icon: "🟢",
    model: "gpt-4o",
    systemPrompt: "",
    temperature: 0.7,
    maxTokens: 4096,
    contextDirectories: [] as string[],
    contextFiles: [] as string[],
    mcpServers: [] as string[],
    agenticMode: false,
    tools: {
      fileEdit: {
        enabled: false,
        approval: "always-ask" as const,
        instructions: "",
      },
      terminal: {
        enabled: false,
        approval: "always-ask" as const,
        instructions: "",
      },
      webFetch: {
        enabled: false,
        approval: "always-ask" as const,
        instructions: "",
      },
    },
    responseFormat: "default",
    isDefault: false,
  };

  let mockStore: ReturnType<typeof createMockAppStore>;

  beforeEach(() => {
    setupMockApi();
    vi.clearAllMocks();
    mockStore = createMockAppStore({
      activeSectionPane: "projects" as const,
      projects: [
        {
          id: "p1",
          name: "Project One",
          color: "blue",
          created_at: 0,
          default_model: null,
        },
      ],
      projectAgents: {},
      agents: [AGENT_A, AGENT_B],
      agentsLoading: false,
      activeProjectId: null,
      activeAgentId: null,
      conversations: [],
      currentConversationId: null,
    });
    setupStoreMock(useAppStore, mockStore);
  });

  // L.1 — Inline agent picker in ProjectsPane
  it('l1-1: "Add agent…" button renders in the project card', () => {
    render(<SectionPane section="projects" />);
    expect(
      screen.getByRole("button", { name: /add agent to project/i }),
    ).toBeInTheDocument();
  });

  it('l1-2: clicking "Add agent…" shows the agent search combobox', async () => {
    render(<SectionPane section="projects" />);
    const btn = screen.getByRole("button", { name: /add agent to project/i });
    await userEvent.click(btn);
    expect(
      screen.getByRole("textbox", { name: /search agents to add/i }),
    ).toBeInTheDocument();
  });

  it("l1-3: combobox shows all agents not yet in the project", async () => {
    render(<SectionPane section="projects" />);
    await userEvent.click(
      screen.getByRole("button", { name: /add agent to project/i }),
    );
    expect(
      screen.getByRole("button", { name: /add alpha bot to project/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /add beta bot to project/i }),
    ).toBeInTheDocument();
  });

  it("l1-4: already-added agents do not appear in the combobox", async () => {
    mockStore = createMockAppStore({
      ...mockStore,
      projectAgents: {
        p1: [
          {
            agentId: "a1",
            agentName: "Alpha Bot",
            agentIcon: "🔵",
            isPrimary: true,
            sortOrder: 0,
          },
        ],
      },
      projects: [
        {
          id: "p1",
          name: "Project One",
          color: "blue",
          created_at: 0,
          default_model: null,
        },
      ],
      agents: [AGENT_A, AGENT_B],
    });
    setupStoreMock(useAppStore, mockStore);
    render(<SectionPane section="projects" />);
    await userEvent.click(
      screen.getByRole("button", { name: /add agent to project/i }),
    );
    expect(
      screen.queryByRole("button", { name: /add alpha bot to project/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /add beta bot to project/i }),
    ).toBeInTheDocument();
  });

  it("l1-5: selecting an agent calls addAgentToProject", async () => {
    render(<SectionPane section="projects" />);
    await userEvent.click(
      screen.getByRole("button", { name: /add agent to project/i }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /add alpha bot to project/i }),
    );
    expect(mockStore.addAgentToProject).toHaveBeenCalledWith("p1", "a1");
  });

  it("l1-6: when project has no members, adding first agent calls setProjectPrimaryAgent", async () => {
    render(<SectionPane section="projects" />);
    await userEvent.click(
      screen.getByRole("button", { name: /add agent to project/i }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /add alpha bot to project/i }),
    );
    expect(mockStore.setProjectPrimaryAgent).toHaveBeenCalledWith("p1", "a1");
  });

  it("l1-7: Escape key closes the combobox", async () => {
    render(<SectionPane section="projects" />);
    await userEvent.click(
      screen.getByRole("button", { name: /add agent to project/i }),
    );
    const input = screen.getByRole("textbox", {
      name: /search agents to add/i,
    });
    await userEvent.keyboard("{Escape}");
    expect(input).not.toBeInTheDocument();
  });

  // L.2 — "Add to project" popover on agent cards in AgentsPane
  it('l2-1: "Add to project" button appears on agent cards in AgentsPane', () => {
    mockStore = createMockAppStore({
      ...mockStore,
      activeSectionPane: "agents" as const,
    });
    setupStoreMock(useAppStore, mockStore);
    render(<SectionPane section="agents" />);
    expect(
      screen.getByRole("button", { name: /add alpha bot to project/i }),
    ).toBeInTheDocument();
  });

  it('l2-2: clicking "Add to project" button opens project list popover', async () => {
    mockStore = createMockAppStore({
      ...mockStore,
      activeSectionPane: "agents" as const,
    });
    setupStoreMock(useAppStore, mockStore);
    render(<SectionPane section="agents" />);
    await userEvent.click(
      screen.getByRole("button", { name: /add alpha bot to project/i }),
    );
    expect(screen.getByText("Project One")).toBeInTheDocument();
  });

  it("l2-3: selecting a project from popover calls addAgentToProject", async () => {
    mockStore = createMockAppStore({
      ...mockStore,
      activeSectionPane: "agents" as const,
    });
    setupStoreMock(useAppStore, mockStore);
    render(<SectionPane section="agents" />);
    await userEvent.click(
      screen.getByRole("button", { name: /add alpha bot to project/i }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /add alpha bot to project one/i }),
    );
    expect(mockStore.addAgentToProject).toHaveBeenCalledWith("p1", "a1");
  });

  // M.6 — Unified add-agent / drop zone
  it("m6-1: unified drop zone renders with combined label", () => {
    render(<SectionPane section="projects" />);
    expect(
      screen.getByRole("button", {
        name: /add agent to project or drop an agent here/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/add agent.*drag from sidebar/i),
    ).toBeInTheDocument();
  });

  it("m6-2: clicking unified zone opens the agent picker", async () => {
    render(<SectionPane section="projects" />);
    await userEvent.click(
      screen.getByRole("button", {
        name: /add agent to project or drop an agent here/i,
      }),
    );
    expect(
      screen.getByRole("textbox", { name: /search agents to add/i }),
    ).toBeInTheDocument();
  });

  it("m6-3: separate standalone drag-only drop zone is no longer rendered", () => {
    render(<SectionPane section="projects" />);
    expect(
      screen.queryByText(/or drag agents from sidebar/i),
    ).not.toBeInTheDocument();
  });

  // M.7 — Primary-agent drop zone is functional
  it("m7-1: no-primary notice renders as a drop target when members exist but none is primary", () => {
    mockStore = createMockAppStore({
      ...mockStore,
      projectAgents: {
        p1: [
          {
            agentId: "a1",
            agentName: "Alpha Bot",
            agentIcon: "🔵",
            isPrimary: false,
            sortOrder: 0,
          },
        ],
      },
      projects: [
        {
          id: "p1",
          name: "My Project",
          color: "blue",
          created_at: 0,
          default_model: null,
        },
      ],
      agents: [
        {
          id: "a1",
          name: "Alpha Bot",
          icon: "🔵",
          systemPrompt: "",
          model: null,
          skills: [],
          toolConfig: {},
          createdAt: 0,
          updatedAt: 0,
        },
      ],
    });
    setupStoreMock(useAppStore, mockStore);
    render(<SectionPane section="projects" />);
    expect(screen.getByText(/no primary agent/i)).toBeInTheDocument();
  });

  it("m7-2: dragging a member over no-primary zone shows drop hint", () => {
    mockStore = createMockAppStore({
      ...mockStore,
      projectAgents: {
        p1: [
          {
            agentId: "a1",
            agentName: "Alpha Bot",
            agentIcon: "🔵",
            isPrimary: false,
            sortOrder: 0,
          },
        ],
      },
      projects: [
        {
          id: "p1",
          name: "My Project",
          color: "blue",
          created_at: 0,
          default_model: null,
        },
      ],
      agents: [
        {
          id: "a1",
          name: "Alpha Bot",
          icon: "🔵",
          systemPrompt: "",
          model: null,
          skills: [],
          toolConfig: {},
          createdAt: 0,
          updatedAt: 0,
        },
      ],
    });
    setupStoreMock(useAppStore, mockStore);
    render(<SectionPane section="projects" />);
    const zone = screen.getByText(/no primary agent/i).closest("div")!;
    fireEvent.dragOver(zone, { dataTransfer: { types: ["member-agent-id"] } });
    expect(screen.getByText(/drop to set as primary/i)).toBeInTheDocument();
  });

  it("m7-3: dropping a member agent on no-primary zone calls setProjectPrimaryAgent", async () => {
    mockStore = createMockAppStore({
      ...mockStore,
      projectAgents: {
        p1: [
          {
            agentId: "a1",
            agentName: "Alpha Bot",
            agentIcon: "🔵",
            isPrimary: false,
            sortOrder: 0,
          },
        ],
      },
      projects: [
        {
          id: "p1",
          name: "My Project",
          color: "blue",
          created_at: 0,
          default_model: null,
        },
      ],
      agents: [
        {
          id: "a1",
          name: "Alpha Bot",
          icon: "🔵",
          systemPrompt: "",
          model: null,
          skills: [],
          toolConfig: {},
          createdAt: 0,
          updatedAt: 0,
        },
      ],
    });
    setupStoreMock(useAppStore, mockStore);
    render(<SectionPane section="projects" />);
    const zone = screen.getByText(/no primary agent/i).closest("div")!;
    fireEvent.drop(zone, {
      dataTransfer: {
        getData: (t: string) => (t === "member-agent-id" ? "a1" : ""),
      },
    });
    await vi.waitFor(() => {
      expect(mockStore.setProjectPrimaryAgent).toHaveBeenCalledWith("p1", "a1");
    });
  });
});

// ── Q.1/Q.2 — "No Project" bucket + Project History pane ──────────────────────

describe("SectionPane — No Project bucket & Project History (Q1/Q2)", () => {
  const now = Date.now();
  const projectConv = {
    id: "pc1",
    agent_id: null,
    title: "Project chat",
    project_id: "p1",
    created_at: now,
    updated_at: now,
  };
  const orphanConv = {
    id: "oc1",
    agent_id: null,
    title: "Orphan chat",
    project_id: null as string | null | undefined,
    created_at: now,
    updated_at: now,
  };

  let mockStore: ReturnType<typeof createMockAppStore>;

  beforeEach(() => {
    setupMockApi();
    vi.clearAllMocks();
    mockStore = createMockAppStore({
      activeSectionPane: "projects" as const,
      projects: [
        { id: "p1", name: "My Project", color: "blue", created_at: 0, default_model: null },
      ],
      projectAgents: {},
      agents: [],
      agentsLoading: false,
      activeProjectId: null,
      activeAgentId: null,
      conversations: [projectConv, orphanConv],
      currentConversationId: null,
      historyProjectId: null,
    });
    setupStoreMock(useAppStore, mockStore);
  });

  it("q1-1: '(No project)' sentinel card renders in ProjectsPane", () => {
    render(<SectionPane section="projects" />);
    expect(screen.getByText(/no project/i)).toBeInTheDocument();
  });

  it("q1-2: clicking '(No project)' sentinel calls selectProject with '__none__'", async () => {
    render(<SectionPane section="projects" />);
    await userEvent.click(screen.getByText(/no project/i));
    expect(mockStore.selectProject).toHaveBeenCalledWith("__none__");
  });

  it("q2-1: when historyProjectId is set, ProjectHistoryPane renders instead of ProjectsPane", () => {
    mockStore = createMockAppStore({
      ...mockStore,
      historyProjectId: "p1",
      activeProjectId: "p1",
    });
    setupStoreMock(useAppStore, mockStore);
    render(<SectionPane section="projects" />);
    // ProjectsPane header shows project name, not "Projects"
    expect(screen.getByRole("heading", { name: /my project/i })).toBeInTheDocument();
    // ProjectsPane project card should NOT be visible
    expect(screen.queryByRole("button", { name: /add agent to project/i })).not.toBeInTheDocument();
  });

  it("q2-2: back button calls setHistoryProjectId(null)", async () => {
    mockStore = createMockAppStore({
      ...mockStore,
      historyProjectId: "p1",
      activeProjectId: "p1",
    });
    setupStoreMock(useAppStore, mockStore);
    render(<SectionPane section="projects" />);
    const backBtn = screen.getByRole("button", { name: /back to projects/i });
    await userEvent.click(backBtn);
    expect(mockStore.setHistoryProjectId).toHaveBeenCalledWith(null);
  });

  it("q2-3: ProjectHistoryPane shows only conversations matching the historyProjectId", () => {
    mockStore = createMockAppStore({
      ...mockStore,
      historyProjectId: "p1",
      activeProjectId: "p1",
    });
    setupStoreMock(useAppStore, mockStore);
    render(<SectionPane section="projects" />);
    expect(screen.getByText("Project chat")).toBeInTheDocument();
    expect(screen.queryByText("Orphan chat")).not.toBeInTheDocument();
  });

  it("q2-4: ProjectHistoryPane with '__none__' shows only orphan conversations", () => {
    mockStore = createMockAppStore({
      ...mockStore,
      historyProjectId: "__none__",
      activeProjectId: "__none__",
    });
    setupStoreMock(useAppStore, mockStore);
    render(<SectionPane section="projects" />);
    expect(screen.getByText("Orphan chat")).toBeInTheDocument();
    expect(screen.queryByText("Project chat")).not.toBeInTheDocument();
  });

  it("q2-5: header shows 'No project' breadcrumb when historyProjectId is '__none__'", () => {
    mockStore = createMockAppStore({
      ...mockStore,
      historyProjectId: "__none__",
    });
    setupStoreMock(useAppStore, mockStore);
    render(<SectionPane section="projects" />);
    expect(screen.getByRole("heading", { name: /no project/i })).toBeInTheDocument();
  });
});
