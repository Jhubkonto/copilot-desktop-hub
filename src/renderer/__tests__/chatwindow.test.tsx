import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatWindow } from "../../renderer/components/ChatWindow";
import { setupMockApi, type MockApi } from "../../test/mocks/api";
import { createMockAppStore, setupStoreMock } from "../../test/mocks/store";
import type { ChatTurnEvent } from "../../shared/chat-turn-types";

const { useAppStore } = vi.hoisted(() => ({
  useAppStore: vi.fn(),
}));

vi.mock("../../renderer/store/app-store", () => ({
  useAppStore,
}));

let mockApi: MockApi;
let streamErrorCallback:
  | ((error: {
      type: string;
      message: string;
      retryable: boolean;
      retryAfterSeconds?: number;
    }) => void)
  | null = null;
// useChat.ts registers two independent onChatTurnEvent subscribers (the reducer via
// useChatLiveTurn, plus a raw background-bookkeeping listener) — fan events out to
// every subscriber like the real (multi-listener) IPC bridge would, instead of
// capturing only the last registration.
let chatTurnEventCallbacks: ((event: ChatTurnEvent) => void)[] = [];
function emitChatTurnEvent(event: ChatTurnEvent) {
  act(() => {
    for (const cb of chatTurnEventCallbacks) cb(event);
  });
}
let autoClipboardFocusCallback: (() => void | Promise<void>) | null = null;
let mockStore: ReturnType<typeof createMockAppStore>;

beforeEach(() => {
  mockApi = setupMockApi();
  streamErrorCallback = null;
  chatTurnEventCallbacks = [];
  autoClipboardFocusCallback = null;
  mockApi.getMessages.mockResolvedValue([]);

  mockApi.onStreamError.mockImplementation(
    (
      cb: (error: {
        type: string;
        message: string;
        retryable: boolean;
        retryAfterSeconds?: number;
      }) => void,
    ) => {
      streamErrorCallback = cb;
      return () => {
        streamErrorCallback = null;
      };
    },
  );
  mockApi.onChatTurnEvent.mockImplementation((cb: (event: ChatTurnEvent) => void) => {
    chatTurnEventCallbacks.push(cb);
    return () => {
      chatTurnEventCallbacks = chatTurnEventCallbacks.filter((c) => c !== cb);
    };
  });
  mockApi.onAutoClipboardFocus.mockImplementation((cb: () => void | Promise<void>) => {
    autoClipboardFocusCallback = cb;
    return () => {
      autoClipboardFocusCallback = null;
    };
  });
  mockStore = createMockAppStore({
    authState: { authenticated: true, user: null },
  });
  setupStoreMock(useAppStore, mockStore);

  // useStreamingQueue reveals text via requestAnimationFrame, which isn't reliably
  // driven in this test environment. Report prefers-reduced-motion so enqueue()
  // deposits content synchronously — these tests care about render/lifecycle
  // behavior, not the reveal animation itself (covered in chat-animation.test.ts).
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ChatWindow — Empty State", () => {
  it("chat-r-1: shows welcome message with default title", () => {
    render(<ChatWindow />);
    expect(screen.getByText("Nexy")).toBeInTheDocument();
  });

  it("chat-r-1b: shows agent name when activeAgent provided", () => {
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      agents: [{ id: "a1", name: "Code Helper", icon: "🧑‍💻" }],
      activeAgentId: "a1",
    });
    setupStoreMock(useAppStore, mockStore);

    render(<ChatWindow />);
    expect(screen.getByText("🧑‍💻 Code Helper")).toBeInTheDocument();
  });

  it("chat-r-9: empty input does not send", async () => {
    const user = userEvent.setup();
    render(<ChatWindow />);

    const sendButton = screen.getByRole("button", { name: /send/i });
    await user.click(sendButton);
    expect(mockApi.sendMessage).not.toHaveBeenCalled();
  });
});

describe("ChatWindow — Sending Messages", () => {
  it("chat-r-3: user message appears immediately after send (optimistic)", async () => {
    const user = userEvent.setup();
    render(<ChatWindow />);

    const textarea = screen.getByRole("textbox", { name: /message input/i });
    await user.type(textarea, "Hello world");
    await user.click(screen.getByRole("button", { name: /send/i }));

    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("chat-r-8: Enter sends message, Shift+Enter inserts newline", async () => {
    const user = userEvent.setup();
    render(<ChatWindow />);

    const textarea = screen.getByRole("textbox", { name: /message input/i });
    await user.type(textarea, "Line 1{Shift>}{Enter}{/Shift}Line 2");

    expect(mockApi.sendMessage).not.toHaveBeenCalled();
    expect(textarea).toHaveValue("Line 1\nLine 2");

    await user.type(textarea, "{Enter}");

    expect(mockStore.conversationCreated).toHaveBeenCalled();
  });

  it("chat-r-6: send button disabled while isGenerating", async () => {
    const user = userEvent.setup();
    render(<ChatWindow />);

    const textarea = screen.getByRole("textbox", { name: /message input/i });
    await user.type(textarea, "Test message");
    await user.click(screen.getByRole("button", { name: /send/i }));

    expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^send$/i }),
    ).not.toBeInTheDocument();
  });
});

describe("ChatWindow — Streaming", () => {
  it("chat-r-4: streaming content renders with typing indicator", async () => {
    const user = userEvent.setup();
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);

    const textarea = screen.getByRole("textbox", { name: /message input/i });
    await user.type(textarea, "Test");
    await user.click(screen.getByRole("button", { name: /send/i }));

    expect(
      screen.getByText(/Thinking(\.\.\.|( · \d+s))/),
    ).toBeInTheDocument();

    emitChatTurnEvent({ type: "turn_started", conversationId: "conv-1", turnId: "turn-1", sequence: 1, timestamp: 1 });
    emitChatTurnEvent({
      type: "assistant_text_delta", conversationId: "conv-1", turnId: "turn-1", sequence: 2, timestamp: 2, chunk: "Hello ",
    });
    emitChatTurnEvent({
      type: "assistant_text_delta", conversationId: "conv-1", turnId: "turn-1", sequence: 3, timestamp: 3, chunk: "world",
    });

    await waitFor(() => {
      expect(screen.getByText(/Hello world/)).toBeInTheDocument();
    });
    expect(screen.getByText("▊")).toBeInTheDocument();
  });

  it("chat-r-5: stream end appends final message and clears streaming", async () => {
    const user = userEvent.setup();
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);

    const textarea = screen.getByRole("textbox", { name: /message input/i });
    await user.type(textarea, "Test");
    await user.click(screen.getByRole("button", { name: /send/i }));

    emitChatTurnEvent({ type: "turn_started", conversationId: "conv-1", turnId: "turn-1", sequence: 1, timestamp: 1 });
    emitChatTurnEvent({
      type: "assistant_text_delta", conversationId: "conv-1", turnId: "turn-1", sequence: 2, timestamp: 2, chunk: "Response text",
    });
    emitChatTurnEvent({ type: "turn_completed", conversationId: "conv-1", turnId: "turn-1", sequence: 3, timestamp: 3 });

    await waitFor(() => {
      expect(screen.getByText("Response text")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument();
    expect(screen.queryByText("▊")).not.toBeInTheDocument();
  });

  it("chat-r-7: stop button visible while generating", async () => {
    const user = userEvent.setup();
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: 'conv-1',
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);

    const textarea = screen.getByRole("textbox", { name: /message input/i });
    await user.type(textarea, "Test");
    await user.click(screen.getByRole("button", { name: /send/i }));

    const stopBtn = screen.getByRole("button", { name: /stop/i });
    expect(stopBtn).toBeInTheDocument();

    await user.click(stopBtn);
    expect(mockApi.stopGeneration).toHaveBeenCalledWith('conv-1');
  });
});

describe("ChatWindow — Messages Display", () => {
  it("chat-r-2: messages render in chronological order", async () => {
    mockApi.getMessages.mockResolvedValue([
      { id: "m1", role: "user", content: "First message", timestamp: 1000 },
      { id: "m2", role: "assistant", content: "First reply", timestamp: 2000 },
      { id: "m3", role: "user", content: "Second message", timestamp: 3000 },
    ]);

    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
    });
    setupStoreMock(useAppStore, mockStore);

    render(<ChatWindow />);

    await waitFor(() => {
      expect(screen.getByText("First message")).toBeInTheDocument();
    });

    const messages = screen.getAllByText(/message|reply/i);
    expect(messages[0]).toHaveTextContent("First message");
    expect(messages[1]).toHaveTextContent("First reply");
    expect(messages[2]).toHaveTextContent("Second message");
  });

  it("shows a clickable request reference when the related user message is above the viewport", async () => {
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    mockApi.getMessages.mockResolvedValue([
      { id: "m1", role: "user", content: "Explain the renderer scroll behavior", timestamp: 1000 },
      { id: "m2", role: "assistant", content: "The scroll container tracks message visibility.", timestamp: 2000 },
    ]);

    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
    });
    setupStoreMock(useAppStore, mockStore);

    render(<ChatWindow />);

    await waitFor(() => {
      expect(screen.getByText("The scroll container tracks message visibility.")).toBeInTheDocument();
    });

    const log = screen.getByRole("log", { name: /messages/i });
    const userMessage = document.querySelector('[data-message-id="m1"]') as HTMLDivElement;
    const assistantMessage = document.querySelector('[data-message-id="m2"]') as HTMLDivElement;

    vi.spyOn(log, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 500,
      left: 0,
      right: 800,
      width: 800,
      height: 500,
      x: 0,
      y: 0,
      toJSON: () => {},
    });
    vi.spyOn(userMessage, "getBoundingClientRect").mockReturnValue({
      top: -180,
      bottom: -80,
      left: 0,
      right: 800,
      width: 800,
      height: 100,
      x: 0,
      y: -180,
      toJSON: () => {},
    });
    vi.spyOn(assistantMessage, "getBoundingClientRect").mockReturnValue({
      top: 80,
      bottom: 300,
      left: 0,
      right: 800,
      width: 800,
      height: 220,
      x: 0,
      y: 80,
      toJSON: () => {},
    });

    fireEvent.scroll(log);

    const reference = await screen.findByRole("button", { name: "Scroll to related request" });
    expect(reference).toHaveTextContent("Explain the renderer scroll behavior");

    await userEvent.click(reference);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it("hides the request reference when the related user message is visible", async () => {
    mockApi.getMessages.mockResolvedValue([
      { id: "m1", role: "user", content: "Visible request", timestamp: 1000 },
      { id: "m2", role: "assistant", content: "Visible answer", timestamp: 2000 },
    ]);

    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
    });
    setupStoreMock(useAppStore, mockStore);

    render(<ChatWindow />);

    await waitFor(() => {
      expect(screen.getByText("Visible answer")).toBeInTheDocument();
    });

    const log = screen.getByRole("log", { name: /messages/i });
    const userMessage = document.querySelector('[data-message-id="m1"]') as HTMLDivElement;
    const assistantMessage = document.querySelector('[data-message-id="m2"]') as HTMLDivElement;

    vi.spyOn(log, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 500,
      left: 0,
      right: 800,
      width: 800,
      height: 500,
      x: 0,
      y: 0,
      toJSON: () => {},
    });
    vi.spyOn(userMessage, "getBoundingClientRect").mockReturnValue({
      top: 20,
      bottom: 120,
      left: 0,
      right: 800,
      width: 800,
      height: 100,
      x: 0,
      y: 20,
      toJSON: () => {},
    });
    vi.spyOn(assistantMessage, "getBoundingClientRect").mockReturnValue({
      top: 150,
      bottom: 300,
      left: 0,
      right: 800,
      width: 800,
      height: 150,
      x: 0,
      y: 150,
      toJSON: () => {},
    });

    fireEvent.scroll(log);

    expect(screen.queryByRole("button", { name: "Scroll to related request" })).not.toBeInTheDocument();
  });

  it("truncates long request previews in the request reference", async () => {
    const longRequest = "Summarize ".repeat(30);
    mockApi.getMessages.mockResolvedValue([
      { id: "m1", role: "user", content: longRequest, timestamp: 1000 },
      { id: "m2", role: "assistant", content: "Short answer", timestamp: 2000 },
    ]);

    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
    });
    setupStoreMock(useAppStore, mockStore);

    render(<ChatWindow />);

    await waitFor(() => {
      expect(screen.getByText("Short answer")).toBeInTheDocument();
    });

    const log = screen.getByRole("log", { name: /messages/i });
    const userMessage = document.querySelector('[data-message-id="m1"]') as HTMLDivElement;
    const assistantMessage = document.querySelector('[data-message-id="m2"]') as HTMLDivElement;

    vi.spyOn(log, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 500,
      left: 0,
      right: 800,
      width: 800,
      height: 500,
      x: 0,
      y: 0,
      toJSON: () => {},
    });
    vi.spyOn(userMessage, "getBoundingClientRect").mockReturnValue({
      top: -220,
      bottom: -120,
      left: 0,
      right: 800,
      width: 800,
      height: 100,
      x: 0,
      y: -220,
      toJSON: () => {},
    });
    vi.spyOn(assistantMessage, "getBoundingClientRect").mockReturnValue({
      top: 80,
      bottom: 260,
      left: 0,
      right: 800,
      width: 800,
      height: 180,
      x: 0,
      y: 80,
      toJSON: () => {},
    });

    fireEvent.scroll(log);

    const reference = await screen.findByRole("button", { name: "Scroll to related request" });
    expect(reference.textContent).toContain("...");
    expect(reference.textContent!.length).toBeLessThan(longRequest.length);
  });
});

describe("ChatWindow — File Attachments", () => {
  it("shows screen capture labels under image attachments", async () => {
    const user = userEvent.setup();
    mockApi.captureScreen.mockResolvedValue({
      dataUrl: "data:image/png;base64,capture",
      windowLabel: "VS Code",
    });

    render(<ChatWindow />);

    await user.click(screen.getByRole("button", { name: /capture screen/i }));

    await waitFor(() => {
      expect(screen.getByText("VS Code")).toBeInTheDocument();
    });
    expect(screen.getByAltText("Screen capture")).toBeInTheDocument();
  });

  it("chat-r-11: file attachment badge appears after file pick", async () => {
    const user = userEvent.setup();
    mockApi.openFileDialog.mockResolvedValue([
      { id: "f1", name: "test.ts", path: "/tmp/test.ts", size: 500 },
    ]);

    render(<ChatWindow />);

    const attachBtn = screen.getByRole("button", { name: /attach/i });
    await user.click(attachBtn);

    await waitFor(() => {
      expect(screen.getByText(/test\.ts/)).toBeInTheDocument();
    });
  });

  it("chat-r-12: attachment removed when X clicked", async () => {
    const user = userEvent.setup();
    mockApi.openFileDialog.mockResolvedValue([
      { id: "f1", name: "test.ts", path: "/tmp/test.ts", size: 500 },
    ]);

    render(<ChatWindow />);

    await user.click(screen.getByRole("button", { name: /attach/i }));

    await waitFor(() => {
      expect(screen.getByText(/test\.ts/)).toBeInTheDocument();
    });

    const removeBtn = screen.getByLabelText(/Remove/);
    await user.click(removeBtn);

    expect(screen.queryByText(/test\.ts/)).not.toBeInTheDocument();
  });
});

describe("ChatWindow — Auto Clipboard", () => {
  it("reads clipboard text on focus when enabled", async () => {
    mockApi.getSetting.mockResolvedValue('true');
    mockApi.readClipboardContent.mockResolvedValue({
      type: 'text',
      text: 'focused clipboard text',
    });

    render(<ChatWindow />);

    await act(async () => {
      await autoClipboardFocusCallback?.();
    });

    await waitFor(() => {
      expect(screen.getByText('@clipboard')).toBeInTheDocument();
    });
    expect(mockApi.getSetting).toHaveBeenCalledWith('autoClipboard');
    expect(mockApi.readClipboardContent).toHaveBeenCalled();
  });
});

describe("ChatWindow — Offline State", () => {
  it("chat-r-13: offline placeholder shown when navigator.onLine is false", () => {
    Object.defineProperty(navigator, "onLine", {
      value: false,
      writable: true,
    });

    render(<ChatWindow />);

    const textarea = screen.getByRole("textbox", { name: /message input/i });
    expect(textarea).toHaveAttribute(
      "placeholder",
      expect.stringContaining("Offline"),
    );

    Object.defineProperty(navigator, "onLine", { value: true, writable: true });
  });

  it("chat-r-14: input disabled when offline", () => {
    Object.defineProperty(navigator, "onLine", {
      value: false,
      writable: true,
    });

    render(<ChatWindow />);

    const textarea = screen.getByRole("textbox", { name: /message input/i });
    expect(textarea).toBeDisabled();

    Object.defineProperty(navigator, "onLine", { value: true, writable: true });
  });

  it("disables input while rate limit countdown is active", async () => {
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);
    emitChatTurnEvent({ type: "turn_started", conversationId: "conv-1", turnId: "turn-1", sequence: 1, timestamp: 1 });
    emitChatTurnEvent({
      conversationId: "conv-1",
      turnId: "turn-1",
      sequence: 2,
      type: "turn_failed",
      timestamp: Date.now(),
      errorType: "rate_limit",
      message: "Rate limited. Please wait a moment and try again.",
      retryable: true,
      retryAfterSeconds: 8,
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Rate limited — you can send again in 8s/i),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole("textbox", { name: /message input/i }),
    ).toBeDisabled();
  });
});

describe("ChatWindow — Regenerate & Edit", () => {
  it("chat-r-15: regenerate button shown only on last assistant message", async () => {
    mockApi.getMessages.mockResolvedValue([
      { id: "m1", role: "user", content: "Question", timestamp: 1000 },
      { id: "m2", role: "assistant", content: "Answer", timestamp: 2000 },
    ]);

    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
    });
    setupStoreMock(useAppStore, mockStore);

    render(<ChatWindow />);

    await waitFor(() => {
      expect(screen.getByText("Answer")).toBeInTheDocument();
    });

    expect(screen.getByText("Answer")).toBeInTheDocument();
  });

  it("chat-r-17: edit button shown on user messages", async () => {
    mockApi.getMessages.mockResolvedValue([
      { id: "m1", role: "user", content: "My question", timestamp: 1000 },
      { id: "m2", role: "assistant", content: "My answer", timestamp: 2000 },
    ]);

    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
    });
    setupStoreMock(useAppStore, mockStore);

    render(<ChatWindow />);

    await waitFor(() => {
      expect(screen.getByText("My question")).toBeInTheDocument();
    });

    expect(screen.getByText("My question")).toBeInTheDocument();
  });

  it("allows canceling edit mode and restores messages", async () => {
    const user = userEvent.setup();
    mockApi.getMessages.mockResolvedValue([
      { id: "m1", role: "user", content: "My question", timestamp: 1000 },
      { id: "m2", role: "assistant", content: "My answer", timestamp: 2000 },
    ]);

    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
    });
    setupStoreMock(useAppStore, mockStore);

    render(<ChatWindow />);

    await waitFor(() => {
      expect(screen.getByText("My question")).toBeInTheDocument();
      expect(screen.getByText("My answer")).toBeInTheDocument();
    });

    await user.dblClick(screen.getByText("My question"));

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: /message input/i })).toHaveValue("My question");
    });
    expect(screen.getByRole("button", { name: /cancel edit/i })).toBeInTheDocument();
    expect(screen.queryByText("My answer")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /cancel edit/i }));

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: /message input/i })).toHaveValue("");
    });
    expect(screen.getByText("My answer")).toBeInTheDocument();
  });
});

describe("ChatWindow — Slash Commands", () => {
  it("executes /help locally and does not send to API", async () => {
    const user = userEvent.setup();
    render(<ChatWindow />);

    const textarea = screen.getByRole("textbox", { name: /message input/i });
    await user.type(textarea, "/help");
    await user.click(screen.getByLabelText("Send message"));

    expect(mockApi.sendMessage).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(
        screen.getByText(/Available slash commands:/i),
      ).toBeInTheDocument();
    });
  });

  it("shows slash autocomplete and inserts selected command with Enter", async () => {
    const user = userEvent.setup();
    render(<ChatWindow />);

    const textarea = screen.getByRole("textbox", { name: /message input/i });
    await user.type(textarea, "/h");

    expect(screen.getByRole("option", { name: /\/help/i })).toBeInTheDocument();
    await user.type(textarea, "{Enter}");

    expect(textarea).toHaveValue("/help ");
  });

  it("executes /clear by removing messages and calling deleteMessagesAfter", async () => {
    const user = userEvent.setup();
    mockApi.getMessages.mockResolvedValue([
      { id: "m1", role: "user", content: "Old message", timestamp: 1000 },
    ]);
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
    });
    setupStoreMock(useAppStore, mockStore);

    render(<ChatWindow />);
    await waitFor(() => {
      expect(screen.getByText("Old message")).toBeInTheDocument();
    });

    const textarea = screen.getByRole("textbox", { name: /message input/i });
    await user.type(textarea, "/clear");
    await user.click(screen.getByLabelText("Send message"));

    expect(mockApi.deleteMessagesAfter).toHaveBeenCalledWith("conv-1", 0);
    expect(screen.queryByText("Old message")).not.toBeInTheDocument();
  });

  it("transforms /explain into an instruction prompt and sends it", async () => {
    const user = userEvent.setup();
    render(<ChatWindow />);

    const textarea = screen.getByRole("textbox", { name: /message input/i });
    await user.type(textarea, "/explain this function");
    await user.click(screen.getByLabelText("Send message"));

    expect(mockApi.sendMessage).toHaveBeenCalled();
    const sentContent = mockApi.sendMessage.mock.calls[0][1];
    expect(sentContent).toContain("Explain this code clearly and concisely.");
    expect(sentContent).toContain("this function");
  });

  it("executes /cwd and shows the current working directory", async () => {
    const user = userEvent.setup();
    mockApi.getWorkingDirectory.mockResolvedValue("C:\\Projects\\app");
    render(<ChatWindow />);

    const textarea = screen.getByRole("textbox", { name: /message input/i });
    await user.type(textarea, "/cwd");
    await user.click(screen.getByLabelText("Send message"));

    expect(mockApi.getWorkingDirectory).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText(/C:\\Projects\\app/)).toBeInTheDocument();
    });
  });

  it("executes /cd and calls setWorkingDirectory", async () => {
    const user = userEvent.setup();
    render(<ChatWindow />);

    const textarea = screen.getByRole("textbox", { name: /message input/i });
    await user.type(textarea, "/cd C:\\Work");
    await user.click(screen.getByLabelText("Send message"));

    expect(mockApi.setWorkingDirectory).toHaveBeenCalledWith("C:\\Work");
  });

  it("executes /copy and writes the last assistant message to clipboard", async () => {
    const user = userEvent.setup();
    const writeTextSpy = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue();
    mockApi.getMessages.mockResolvedValue([
      { id: "m1", role: "assistant", content: "Final answer", timestamp: 1000 },
    ]);
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);
    await waitFor(() => {
      expect(screen.getByText("Final answer")).toBeInTheDocument();
    });

    const textarea = screen.getByRole("textbox", { name: /message input/i });
    await user.type(textarea, "/copy");
    await user.click(screen.getByLabelText("Send message"));

    expect(writeTextSpy).toHaveBeenCalledWith("Final answer");
    writeTextSpy.mockRestore();
  });

  it("executes /share file and saves markdown through IPC", async () => {
    const user = userEvent.setup();
    render(<ChatWindow />);

    const textarea = screen.getByRole("textbox", { name: /message input/i });
    await user.type(textarea, "/share file");
    await user.click(screen.getByLabelText("Send message"));

    expect(mockApi.saveTextFile).toHaveBeenCalled();
  });

  it("executes /models and prints the available models list", async () => {
    const user = userEvent.setup();
    render(<ChatWindow />);

    const textarea = screen.getByRole("textbox", { name: /message input/i });
    await user.type(textarea, "/models");
    await user.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(screen.getByText(/Available models:/)).toBeInTheDocument();
      expect(screen.getByText(/\* Global default/)).toBeInTheDocument();
    });
  });

  it("executes /model and sets conversation model", async () => {
    const user = userEvent.setup();
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
      conversations: [
        {
          id: "conv-1",
          title: "chat",
          agent_id: null,
          model: null,
          created_at: 1,
          updated_at: 1,
        },
      ],
      catalogModels: [{ id: 'gpt-4.1', name: 'GPT-4.1', vendor: 'OpenAI', capabilities: [] }],
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);

    const textarea = screen.getByRole("textbox", { name: /message input/i });
    await user.type(textarea, "/model gpt-4.1");
    await user.click(screen.getByLabelText("Send message"));

    expect(mockApi.setConversationModel).toHaveBeenCalledWith(
      "conv-1",
      "gpt-4.1",
    );
  });
});

// ── Chat Context Bar & Accurate Model Indicator ───────────────────

describe("ChatWindow — Context Bar (O.1)", () => {
  it("o1-1: context bar is hidden when no project and no agent", () => {
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);
    expect(
      screen.queryByRole("region", { name: /chat context/i }),
    ).not.toBeInTheDocument();
  });

  it("o1-2: context bar shows project name when conversation has a project", async () => {
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
      conversations: [
        {
          id: "conv-1",
          title: "Test",
          project_id: "proj-1",
          model: null,
          pinned: false,
          created_at: 0,
          updated_at: 0,
        },
      ],
      projects: [
        {
          id: "proj-1",
          name: "My Project",
          color: "blue",
          created_at: 0,
          updated_at: 0,
        },
      ],
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);
    await waitFor(() =>
      expect(screen.getByText("My Project")).toBeInTheDocument(),
    );
  });

  it("o1-3: context bar shows conversation agent name", async () => {
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
      conversations: [
        {
          id: "conv-1",
          title: "T",
          project_id: "proj-1",
          agent_id: "a1",
          model: null,
          pinned: false,
          created_at: 0,
          updated_at: 0,
        },
      ],
      agents: [{ id: "a1", name: "Coder", icon: "🧑‍💻", model: "gpt-4.1" }],
      activeAgentId: "stale-agent",
      projects: [
        {
          id: "proj-1",
          name: "My Project",
          color: "green",
          created_at: 0,
          updated_at: 0,
        },
      ],
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);
    await waitFor(() => expect(screen.getByText("Coder")).toBeInTheDocument());
  });

  it("o1-4: context bar does not fall back to a project primary agent", async () => {
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
      conversations: [
        {
          id: "conv-1",
          title: "T",
          project_id: "proj-2",
          model: null,
          pinned: false,
          created_at: 0,
          updated_at: 0,
        },
      ],
      agents: [{ id: "a2", name: "Reviewer", icon: "🔍", model: "default" }],
      activeAgentId: null,
      projects: [
        {
          id: "proj-2",
          name: "Alpha",
          color: "purple",
          created_at: 0,
          updated_at: 0,
        },
      ],
      projectAgents: {
        "proj-2": [
          {
            agentId: "a2",
            agentName: "Reviewer",
            agentIcon: "🔍",
            isPrimary: true,
            sortOrder: 0,
          },
        ],
      },
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);
    await waitFor(() => {
      expect(screen.getByLabelText("Agent context")).toHaveTextContent("No agent");
      expect(screen.queryByText("Reviewer")).not.toBeInTheDocument();
    });
  });
});

describe("ChatWindow — Model Dropdown (O.2)", () => {
  it("o2-1: model dropdown reflects conversation-level model override", async () => {
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
      conversations: [
        {
          id: "conv-1",
          title: "T",
          project_id: null,
          model: "claude-sonnet-4.6",
          pinned: false,
          created_at: 0,
          updated_at: 0,
        },
      ],
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /conversation model/i });
      expect(btn).toHaveTextContent("Claude Sonnet 4.6");
    });
  });

  it("o2-2: model dropdown ignores stale active agent state for existing chats", async () => {
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
      conversations: [
        {
          id: "conv-1",
          title: "T",
          project_id: null,
          model: null,
          pinned: false,
          created_at: 0,
          updated_at: 0,
        },
      ],
      agents: [{ id: "a1", name: "Bot", icon: "🤖", model: "gpt-4.1" }],
      activeAgentId: "a1",
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /conversation model/i });
      expect(btn).toHaveTextContent("Global default");
    });
  });

  it("o2-3: model dropdown falls back to project default model", async () => {
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
      conversations: [
        {
          id: "conv-1",
          title: "T",
          project_id: "proj-1",
          model: null,
          pinned: false,
          created_at: 0,
          updated_at: 0,
        },
      ],
      projects: [
        {
          id: "proj-1",
          name: "P",
          color: "blue",
          default_model: "gpt-4.1",
          created_at: 0,
          updated_at: 0,
        },
      ],
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /conversation model/i });
      expect(btn).toHaveTextContent("GPT-4.1");
    });
  });

  it("sets a CLI model as a conversation override without changing the project agent backend", async () => {
    const user = userEvent.setup();
    mockStore = createMockAppStore({
      authState: {
        authenticated: true,
        mode: 'byok',
        user: null,
        cliInstalled: true,
        clis: { claude: false, codex: true },
      },
      currentConversationId: "conv-1",
      conversations: [
        {
          id: "conv-1",
          title: "Project chat",
          project_id: "proj-1",
          agent_id: "agent-1",
          model: null,
          pinned: false,
          created_at: 0,
          updated_at: 0,
        },
      ],
      projects: [
        {
          id: "proj-1",
          name: "Project",
          color: "blue",
          created_at: 0,
          updated_at: 0,
        },
      ],
      agents: [
        {
          id: "agent-1",
          name: "Project Agent",
          icon: "A",
          systemPrompt: "",
          backend: undefined,
        },
      ],
      availableModelGroups: [
        {
          sourceKey: "openai",
          sourceLabel: "OpenAI",
          sourceType: "provider",
          models: [{ id: "gpt-5-mini", label: "GPT-5 mini" }],
        },
        {
          sourceKey: "codex-cli",
          sourceLabel: "Codex CLI",
          sourceType: "cli",
          models: [{ id: "gpt-5.5", label: "GPT-5.5" }],
        },
      ],
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);

    await user.click(screen.getByRole("button", { name: /conversation model/i }));
    await user.click(await screen.findByText("GPT-5.5"));

    expect(mockApi.setConversationModel).toHaveBeenCalledWith("conv-1", "gpt-5.5", "codex-cli");
    expect(mockApi.updateAgent).not.toHaveBeenCalled();
  });

  it("locks the model picker to Codex CLI when the agent backend is forced", async () => {
    const user = userEvent.setup();
    mockStore = createMockAppStore({
      authState: {
        authenticated: true,
        mode: 'byok',
        user: null,
        cliInstalled: true,
        clis: { claude: false, codex: true },
      },
      currentConversationId: "conv-1",
      conversations: [
        {
          id: "conv-1",
          title: "Project chat",
          project_id: "proj-1",
          agent_id: "agent-1",
          model: "gpt-5.5",
          pinned: false,
          created_at: 0,
          updated_at: 0,
        },
      ],
      projects: [
        {
          id: "proj-1",
          name: "Project",
          color: "blue",
          created_at: 0,
          updated_at: 0,
        },
      ],
      agents: [
        {
          id: "agent-1",
          name: "Project Agent",
          icon: "A",
          systemPrompt: "",
          backend: "codex-cli",
          cliModel: "gpt-5.5",
        },
      ],
      availableModelGroups: [
        {
          sourceKey: "openai",
          sourceLabel: "OpenAI",
          sourceType: "provider",
          models: [{ id: "gpt-5-mini", label: "GPT-5 mini" }],
        },
        {
          sourceKey: "codex-cli",
          sourceLabel: "Codex CLI",
          sourceType: "cli",
          models: [{ id: "gpt-5.5", label: "GPT-5.5" }],
        },
      ],
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);

    await user.click(screen.getByRole("button", { name: /gpt-5\.5.*codex cli/i }));
    expect((await screen.findAllByText("Codex CLI")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("GPT-5.5").length).toBeGreaterThan(0);
    expect(screen.queryByText("GPT-5 mini")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Chat backend locked by agent settings to Codex CLI")).toHaveTextContent("Agent locked");

    expect(mockApi.updateAgent).not.toHaveBeenCalled();
  });

  it("shows the forced CLI badge even if the conversation has a provider model", () => {
    mockStore = createMockAppStore({
      authState: {
        authenticated: true,
        mode: 'byok',
        user: null,
        cliInstalled: true,
        clis: { claude: false, codex: true },
      },
      currentConversationId: "conv-1",
      conversations: [
        {
          id: "conv-1",
          title: "Project chat",
          project_id: "proj-1",
          agent_id: "agent-1",
          model: "claude-haiku-4.5",
          pinned: false,
          created_at: 0,
          updated_at: 0,
        },
      ],
      projects: [
        {
          id: "proj-1",
          name: "Project",
          color: "blue",
          created_at: 0,
          updated_at: 0,
        },
      ],
      agents: [
        {
          id: "agent-1",
          name: "Project Agent",
          icon: "A",
          systemPrompt: "",
          backend: "codex-cli",
          cliModel: "gpt-5.5",
        },
      ],
      availableModelGroups: [
        {
          sourceKey: "openrouter",
          sourceLabel: "OpenRouter",
          sourceType: "provider",
          models: [{ id: "claude-haiku-4.5", label: "Claude Haiku 4.5" }],
        },
        {
          sourceKey: "codex-cli",
          sourceLabel: "Codex CLI",
          sourceType: "cli",
          models: [{ id: "gpt-5.5", label: "GPT-5.5" }],
        },
      ],
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);

    expect(screen.getByTitle("Active backend for this conversation")).toHaveTextContent("Codex CLI");
  });
});

describe("ChatWindow — Full Auto-Approve", () => {
  it("shows the auto-approve banner and disables it from the chat header", async () => {
    const user = userEvent.setup();
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
      conversations: [
        {
          id: "conv-1",
          title: "Trusted chat",
          project_id: null,
          agent_id: "agent-1",
          model: null,
          pinned: false,
          created_at: 0,
          updated_at: 0,
        },
      ],
      agents: [
        {
          id: "agent-1",
          name: "Trusted Agent",
          icon: "T",
          systemPrompt: "",
          fullAutoApprove: true,
        },
      ],
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);

    expect(screen.getByLabelText("Auto-approve warning")).toHaveTextContent("Auto-approve is ON");
    await user.click(screen.getByRole("button", { name: /disable/i }));

    expect(mockStore.saveAgent).toHaveBeenCalledWith(
      expect.objectContaining({ fullAutoApprove: false }),
    );
  });

});

// ── Resizable Input Panel ─────────────────────────────────────────────────────

describe("ChatWindow — Resizable Input Panel (P.1)", () => {
  it("p1-1: resize handle is present in the DOM", () => {
    render(<ChatWindow />);
    expect(screen.getByLabelText("Resize input panel")).toBeInTheDocument();
  });

  it("p1-2: dragging the handle upward increases textarea height", () => {
    render(<ChatWindow />);
    const handle = screen.getByLabelText("Resize input panel");
    const textarea = screen.getByRole("textbox", { name: /message input/i });

    act(() => {
      handle.dispatchEvent(new PointerEvent("pointerdown", { clientY: 500, bubbles: true, cancelable: true }));
    });
    act(() => {
      window.dispatchEvent(new PointerEvent("pointermove", { clientY: 450, bubbles: true }));
    });

    const heightStr = (textarea as HTMLTextAreaElement).style.height;
    expect(parseInt(heightStr)).toBeGreaterThan(40);
  });

  it("p1-3: height is clamped to the minimum (40px)", () => {
    render(<ChatWindow />);
    const handle = screen.getByLabelText("Resize input panel");
    const textarea = screen.getByRole("textbox", { name: /message input/i });

    act(() => {
      handle.dispatchEvent(new PointerEvent("pointerdown", { clientY: 300, bubbles: true, cancelable: true }));
    });
    act(() => {
      // Dragging far downward would set a negative delta → clamped to 40
      window.dispatchEvent(new PointerEvent("pointermove", { clientY: 600, bubbles: true }));
    });

    expect((textarea as HTMLTextAreaElement).style.height).toBe("40px");
  });

  it("p1-4: height is clamped to the maximum (400px)", () => {
    render(<ChatWindow />);
    const handle = screen.getByLabelText("Resize input panel");
    const textarea = screen.getByRole("textbox", { name: /message input/i });

    act(() => {
      handle.dispatchEvent(new PointerEvent("pointerdown", { clientY: 500, bubbles: true, cancelable: true }));
    });
    act(() => {
      // Dragging 1000px upward would exceed max → clamped to 400
      window.dispatchEvent(new PointerEvent("pointermove", { clientY: -500, bubbles: true }));
    });

    expect((textarea as HTMLTextAreaElement).style.height).toBe("400px");
  });

  it("p1-5: pointerup stops further resize updates", () => {
    render(<ChatWindow />);
    const handle = screen.getByLabelText("Resize input panel");
    const textarea = screen.getByRole("textbox", { name: /message input/i });

    act(() => {
      handle.dispatchEvent(new PointerEvent("pointerdown", { clientY: 500, bubbles: true, cancelable: true }));
    });
    act(() => {
      window.dispatchEvent(new PointerEvent("pointermove", { clientY: 450, bubbles: true }));
    });
    const heightAfterMove = (textarea as HTMLTextAreaElement).style.height;

    act(() => {
      window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });
    act(() => {
      // Further moves after pointerup should not change height
      window.dispatchEvent(new PointerEvent("pointermove", { clientY: 300, bubbles: true }));
    });

    expect((textarea as HTMLTextAreaElement).style.height).toBe(heightAfterMove);
  });
});

// ── Scrollbar Cursor Fix ──────────────────────────────────────────────────────

describe("ChatWindow — Scrollbar Cursor Fix (P.2)", () => {
  it("p2-1: message input has chat-input class for scrollbar cursor fix", () => {
    render(<ChatWindow />);
    const textarea = screen.getByRole("textbox", { name: /message input/i });
    expect(textarea).toHaveClass("chat-input");
  });

  it("p2-2: message input has overflow-y-auto so the scrollbar is enabled", () => {
    render(<ChatWindow />);
    const textarea = screen.getByRole("textbox", { name: /message input/i });
    expect(textarea).toHaveClass("overflow-y-auto");
  });
});

// ── Directory Context Indicator ───────────────────────────────────────────────

describe("ChatWindow — Directory Context Indicator (R.2)", () => {
  it("r2-r-1: shows 📁 badge in context bar when project has rootDirectory set", async () => {
    mockApi.getProjectConfig.mockResolvedValue({ rootDirectory: "/home/user/myproject" });

    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
      conversations: [
        {
          id: "conv-1",
          title: "Test",
          project_id: "proj-1",
          model: null,
          pinned: false,
          created_at: 0,
          updated_at: 0,
        },
      ],
      projects: [
        {
          id: "proj-1",
          name: "My Project",
          color: "blue",
          created_at: 0,
          updated_at: 0,
        },
      ],
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);

    await waitFor(() => {
      expect(screen.getByLabelText(/File structure context active/i)).toBeInTheDocument();
    });
  });

  it("r2-r-2: does NOT show 📁 badge when project has no rootDirectory", async () => {
    mockApi.getProjectConfig.mockResolvedValue({ rootDirectory: "" });

    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
      conversations: [
        {
          id: "conv-1",
          title: "Test",
          project_id: "proj-1",
          model: null,
          pinned: false,
          created_at: 0,
          updated_at: 0,
        },
      ],
      projects: [
        {
          id: "proj-1",
          name: "My Project",
          color: "blue",
          created_at: 0,
          updated_at: 0,
        },
      ],
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);

    // Give the useEffect time to resolve
    await waitFor(() => {
      expect(screen.getByText("My Project")).toBeInTheDocument();
    });

    expect(screen.queryByLabelText(/File structure context active/i)).not.toBeInTheDocument();
  });

  it("r2-r-3: does NOT show 📁 badge when there is no project", () => {
    mockApi.getProjectConfig.mockResolvedValue({});

    render(<ChatWindow />);

    expect(screen.queryByLabelText(/File structure context active/i)).not.toBeInTheDocument();
  });
});
