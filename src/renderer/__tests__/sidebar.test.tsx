import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sidebar } from "../../renderer/components/Sidebar";
import { setupMockApi, type MockApi } from "../../test/mocks/api";
import { createMockAppStore, setupStoreMock } from "../../test/mocks/store";

const { useAppStore } = vi.hoisted(() => ({
  useAppStore: vi.fn(),
}));

vi.mock("../../renderer/store/app-store", () => ({
  useAppStore,
}));

let mockApi: MockApi;

const now = Date.now();
const todayConv = {
  id: "c1",
  agent_id: null,
  title: "Today chat",
  created_at: now,
  updated_at: now,
};
const yesterdayConv = {
  id: "c2",
  agent_id: null,
  title: "Yesterday chat",
  created_at: now - 86400000 - 1000,
  updated_at: now - 86400000 - 1000,
};
const olderConv = {
  id: "c3",
  agent_id: null,
  title: "Old chat",
  created_at: now - 30 * 86400000,
  updated_at: now - 30 * 86400000,
};

const testAgents = [
  { id: "a1", name: "Code Helper", icon: "🧑‍💻", isDefault: true },
  { id: "a2", name: "Writer", icon: "✍️", isDefault: false },
];

let mockStore: ReturnType<typeof createMockAppStore>;

beforeEach(() => {
  mockApi = setupMockApi();
  mockApi.searchConversations.mockResolvedValue([]);
  mockApi.renameConversation.mockResolvedValue(undefined);

  mockStore = createMockAppStore({
    conversations: [todayConv, yesterdayConv, olderConv],
    agents: testAgents,
  });
  setupStoreMock(useAppStore, mockStore);
});

describe("Sidebar — Conversation List", () => {
  it("side-r-1: conversations grouped by date (Today, Yesterday, Older)", () => {
    render(<Sidebar />);
    // Section headers are uppercase text in the date group labels
    const headers = screen.getAllByText("Today");
    expect(headers.length).toBeGreaterThanOrEqual(1);
    const yesterdayEls = screen.getAllByText("Yesterday");
    expect(yesterdayEls.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Older")).toBeInTheDocument();
  });

  it("side-r-2: clicking conversation calls selectConversation", async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByText("Today chat"));
    expect(mockStore.selectConversation).toHaveBeenCalledWith("c1");
  });

  it("side-r-3: active conversation highlighted", () => {
    mockStore = createMockAppStore({
      conversations: [todayConv, yesterdayConv, olderConv],
      agents: testAgents,
      currentConversationId: "c1",
    });
    setupStoreMock(useAppStore, mockStore);

    render(<Sidebar />);

    const todayItem = screen
      .getByText("Today chat")
      .closest('div[class*="cursor-pointer"]');
    expect(todayItem?.className).toContain("bg-");
  });

  it('side-r-4: "New Chat" button calls newChat', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByText("New Chat"));
    expect(mockStore.newChat).toHaveBeenCalled();
  });

  it("side-r-5: delete button opens confirmation dialog and confirms deletion", async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    const deleteButtons = screen.getAllByTitle("Delete conversation");
    await user.click(deleteButtons[0]);

    // Dialog should appear
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Confirm deletion
    await user.click(screen.getByRole("button", { name: /delete chat/i }));
    expect(mockStore.deleteConversation).toHaveBeenCalledWith("c1");
  });

  it("side-r-5b: delete button opens confirmation dialog and cancel dismisses without deleting", async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    const deleteButtons = screen.getAllByTitle("Delete conversation");
    await user.click(deleteButtons[0]);

    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(mockStore.deleteConversation).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("pins a conversation from the list", async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    const pinButtons = screen.getAllByTitle("Pin conversation");
    await user.click(pinButtons[0]);

    expect(mockApi.setConversationPinned).toHaveBeenCalledWith("c1", true);
    expect(mockStore.loadConversations).toHaveBeenCalled();
  });

  it('shows "No conversations yet" when list is empty', () => {
    mockStore = createMockAppStore({ agents: testAgents });
    setupStoreMock(useAppStore, mockStore);

    render(<Sidebar />);
    expect(screen.getByText("No conversations yet")).toBeInTheDocument();
  });
});

describe("Sidebar — Inline Rename", () => {
  it("side-r-6: double-click shows edit field, Enter saves", async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    const titleEl = screen.getByText("Today chat");
    await user.dblClick(titleEl);

    const input = screen.getByDisplayValue("Today chat");
    expect(input).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "Renamed Chat{Enter}");

    expect(mockApi.renameConversation).toHaveBeenCalledWith(
      "c1",
      "Renamed Chat",
    );
    expect(mockStore.loadConversations).toHaveBeenCalled();
  });

  it("side-r-7: Escape cancels rename", async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.dblClick(screen.getByText("Today chat"));
    const input = screen.getByDisplayValue("Today chat");
    await user.type(input, " extra{Escape}");

    expect(
      screen.queryByDisplayValue("Today chat extra"),
    ).not.toBeInTheDocument();
    expect(mockApi.renameConversation).not.toHaveBeenCalled();
  });
});

describe("Sidebar — Search", () => {
  it("side-r-8: search filters conversations by title", async () => {
    const user = userEvent.setup();
    mockApi.searchConversations.mockResolvedValue([todayConv]);
    render(<Sidebar />);

    const searchInput = screen.getByPlaceholderText("Search conversations...");
    await user.type(searchInput, "Today");

    await waitFor(() => {
      expect(mockApi.searchConversations).toHaveBeenCalledWith("Today");
    });
  });

  it("side-r-10: empty search shows all conversations", async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    const searchInput = screen.getByPlaceholderText("Search conversations...");
    await user.type(searchInput, "test");

    await waitFor(() => {
      expect(mockApi.searchConversations).toHaveBeenCalled();
    });

    await user.clear(searchInput);

    await waitFor(() => {
      expect(screen.getByText("Today chat")).toBeInTheDocument();
      expect(screen.getByText("Yesterday chat")).toBeInTheDocument();
      expect(screen.getByText("Old chat")).toBeInTheDocument();
    });
  });

  it('shows "No matching conversations" when search returns empty', async () => {
    const user = userEvent.setup();
    mockApi.searchConversations.mockResolvedValue([]);
    mockStore = createMockAppStore({ agents: testAgents });
    setupStoreMock(useAppStore, mockStore);

    render(<Sidebar />);

    const searchInput = screen.getByPlaceholderText("Search conversations...");
    await user.type(searchInput, "nonexistent");

    await waitFor(() => {
      expect(screen.getByText("No matching conversations")).toBeInTheDocument();
    });
  });
});

describe("Sidebar — Agent List", () => {
  it("side-r-11: agent list renders with icons and names", () => {
    render(<Sidebar />);
    expect(screen.getByText(/Code Helper/)).toBeInTheDocument();
    expect(screen.getByText(/Writer/)).toBeInTheDocument();
  });

  it("side-r-12: selecting agent calls selectAgent", async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByText(/Code Helper/));
    expect(mockStore.selectAgent).toHaveBeenCalledWith("a1");
  });

  it("side-r-13: active agent highlighted", () => {
    mockStore = createMockAppStore({
      conversations: [todayConv, yesterdayConv, olderConv],
      agents: testAgents,
      activeAgentId: "a1",
    });
    setupStoreMock(useAppStore, mockStore);

    render(<Sidebar />);

    const agentItem = screen
      .getByText(/Code Helper/)
      .closest('div[class*="cursor-grab"]');
    expect(agentItem?.className).toContain("bg-");
  });

  it('side-r-14: "No Agent" option deselects active agent', async () => {
    const user = userEvent.setup();
    mockStore = createMockAppStore({
      conversations: [todayConv, yesterdayConv, olderConv],
      agents: testAgents,
      activeAgentId: "a1",
    });
    setupStoreMock(useAppStore, mockStore);

    render(<Sidebar />);

    await user.click(screen.getByText("No agent"));
    expect(mockStore.selectAgent).toHaveBeenCalledWith(null);
  });

  it('shows "No agents configured" when agents list is empty', () => {
    mockStore = createMockAppStore();
    setupStoreMock(useAppStore, mockStore);

    render(<Sidebar />);
    expect(screen.getByText("No agents configured")).toBeInTheDocument();
  });
});

describe("Sidebar — Auth Section", () => {
  it('side-r-15: shows "Sign in" when unauthenticated', () => {
    render(<Sidebar />);
    expect(screen.getByText(/Sign in with GitHub/)).toBeInTheDocument();
  });

  it("side-r-16: shows avatar + username when authenticated", () => {
    mockStore = createMockAppStore({
      conversations: [todayConv, yesterdayConv, olderConv],
      agents: testAgents,
      authState: {
        authenticated: true,
        user: {
          login: "testuser",
          avatar_url: "https://example.com/avatar.png",
          name: "Test User",
        },
      },
    });
    setupStoreMock(useAppStore, mockStore);

    render(<Sidebar />);
    expect(screen.getByText("Test User")).toBeInTheDocument();
    expect(screen.getByAltText("testuser")).toBeInTheDocument();
  });

  it("side-r-16b: shows login when name is null", () => {
    mockStore = createMockAppStore({
      conversations: [todayConv, yesterdayConv, olderConv],
      agents: testAgents,
      authState: {
        authenticated: true,
        user: {
          login: "testuser",
          avatar_url: "https://example.com/avatar.png",
          name: null,
        },
      },
    });
    setupStoreMock(useAppStore, mockStore);

    render(<Sidebar />);
    expect(screen.getByText("testuser")).toBeInTheDocument();
  });

  it("side-r-17: sign in button calls login", async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByText(/Sign in with GitHub/));
    expect(mockStore.login).toHaveBeenCalled();
  });

  it("side-r-18: sign out button calls logout", async () => {
    const user = userEvent.setup();
    mockStore = createMockAppStore({
      conversations: [todayConv, yesterdayConv, olderConv],
      agents: testAgents,
      authState: {
        authenticated: true,
        user: {
          login: "testuser",
          avatar_url: "https://example.com/avatar.png",
          name: "Test",
        },
      },
    });
    setupStoreMock(useAppStore, mockStore);

    render(<Sidebar />);

    await user.click(screen.getByText("Sign out"));
    expect(mockStore.logout).toHaveBeenCalled();
  });
});

// ── Sidebar drag-to-project (L.3) ─────────────────────────────────

describe("Sidebar — Drag-to-project (L3)", () => {
  const dragAgent = {
    id: "drag-a",
    name: "Drag Agent",
    icon: "🚀",
    isDefault: false,
  };
  const dragProject = {
    id: "drag-p",
    name: "Drop Project",
    color: "blue",
    created_at: 0,
    default_model: null,
  };

  beforeEach(() => {
    mockStore = createMockAppStore({
      conversations: [],
      agents: [dragAgent],
      projects: [dragProject],
      projectAgents: {},
    });
    setupStoreMock(useAppStore, mockStore);
  });

  it("l3-1: agent entries in the sidebar have draggable=true", () => {
    render(<Sidebar />);
    const agentEl = screen.getByText(/Drag Agent/).closest("div[draggable]");
    expect(agentEl).not.toBeNull();
    expect(agentEl).toHaveAttribute("draggable", "true");
  });

  it("l3-2: dropping an agent onto a project entry calls addAgentToProject", async () => {
    render(<Sidebar />);
    const agentEl = screen
      .getByText(/Drag Agent/)
      .closest("div[draggable]") as HTMLElement;
    const projectEl = screen
      .getByText(/Drop Project/)
      .closest("div[class]") as HTMLElement;

    // simulate drag start to set the transfer data
    const dt: Record<string, string> = {};
    fireEvent.dragStart(agentEl, {
      dataTransfer: {
        setData: (k: string, v: string) => {
          dt[k] = v;
        },
        types: [],
        effectAllowed: "copy",
      },
    });

    fireEvent.dragOver(projectEl, {
      dataTransfer: {
        types: ["sidebar-agent-id"],
        getData: (k: string) => dt[k] ?? "",
        dropEffect: "copy",
      },
    });

    fireEvent.drop(projectEl, {
      dataTransfer: {
        types: ["sidebar-agent-id"],
        getData: (k: string) => dt[k] ?? "",
      },
    });

    await waitFor(() => {
      expect(mockStore.addAgentToProject).toHaveBeenCalledWith(
        "drag-p",
        "drag-a",
      );
    });
  });
});

// ── M.8: Project hover gear icon ─────────────────────────────────────────────

describe("Sidebar — Project gear icon (M.8)", () => {
  const gearProject = {
    id: "gear-p",
    name: "Gear Project",
    color: "blue",
    created_at: 0,
    default_model: null,
  };

  beforeEach(() => {
    mockStore = createMockAppStore({
      conversations: [],
      agents: [],
      projects: [gearProject],
      projectAgents: {},
    });
    setupStoreMock(useAppStore, mockStore);
  });

  it('m8-1: project row renders a "Project settings" button', () => {
    render(<Sidebar />);
    expect(
      screen.getByRole("button", { name: "Project settings" }),
    ).toBeInTheDocument();
  });

  it("m8-2: clicking the gear button calls openEditProject with the project id", async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    await user.click(screen.getByRole("button", { name: "Project settings" }));
    expect(mockStore.openEditProject).toHaveBeenCalledWith("gear-p");
  });

  it("m8-3: no dropdown menu or model picker renders for projects", () => {
    render(<Sidebar />);
    expect(screen.queryByText("Rename")).not.toBeInTheDocument();
    expect(screen.queryByText("Set default model")).not.toBeInTheDocument();
    expect(screen.queryByText("Delete project")).not.toBeInTheDocument();
  });
});

// ── Q.1 — "No project" sentinel in Sidebar ────────────────────────────────────

describe("Sidebar — No project sentinel (Q1)", () => {
  const noProjectSentinelProject = {
    id: "sent-p",
    name: "Sentinel Project",
    color: "blue",
    created_at: 0,
    default_model: null,
  };

  beforeEach(() => {
    mockStore = createMockAppStore({
      conversations: [],
      agents: [],
      projects: [noProjectSentinelProject],
      projectAgents: {},
    });
    setupStoreMock(useAppStore, mockStore);
  });

  it("q1-sb-1: '(No project)' sentinel renders above the Projects section header", () => {
    render(<Sidebar />);
    expect(screen.getByText(/no project/i)).toBeInTheDocument();
  });

  it("q1-sb-2: clicking the '(No project)' entry calls selectProject with '__none__'", async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    await user.click(screen.getByText(/no project/i));
    expect(mockStore.selectProject).toHaveBeenCalledWith("__none__");
  });
});
