import { describe, expect, it, vi } from "vitest";
import type { ChatMessage, ChatToolCall } from "../src/llm/index.js";
import { runToolLoop, type ToolLoopChat } from "../src/tools/loop.js";
import type { ServerTool, ToolDef } from "../src/tools/types.js";

const clientTool: ToolDef = {
  name: "start_timer",
  description: "Start the timer.",
  parameters: { type: "object", properties: {} },
  execution: "client",
};

function serverTool(
  handler: (userId: string, args: Record<string, unknown>) => Promise<unknown>
): ServerTool {
  return {
    name: "deals_summary",
    description: "List deals.",
    parameters: { type: "object", properties: {} },
    execution: "server",
    handler,
  };
}

function call(name: string, id = "call_1", args = "{}"): ChatToolCall {
  return { id, type: "function", function: { name, arguments: args } };
}

const baseMessages: ChatMessage[] = [
  { role: "system", content: "prompt" },
  { role: "user", content: "do the thing" },
];

/** vi.fn wrapper that also snapshots the messages seen by each chat call. */
function mockChat(
  ...turns: { content: string | null; toolCalls: ChatToolCall[] }[]
) {
  const seenMessages: ChatMessage[][] = [];
  let turnIdx = 0;
  const chat: ToolLoopChat = async ({ messages }) => {
    seenMessages.push([...messages]);
    const turn = turns[Math.min(turnIdx, turns.length - 1)];
    turnIdx++;
    return turn;
  };
  return { chat: vi.fn(chat), seenMessages };
}

describe("runToolLoop", () => {
  it("returns speech when the model calls no tools", async () => {
    const { chat } = mockChat({ content: "All done.", toolCalls: [] });
    const outcome = await runToolLoop({
      userId: "u1",
      messages: baseMessages,
      clientTools: [clientTool],
      serverTools: [],
      chat,
    });
    expect(outcome).toMatchObject({ kind: "speech", speech: "All done." });
    expect(outcome.messages.at(-1)).toEqual({
      role: "assistant",
      content: "All done.",
    });
  });

  it("returns client tool calls with the assistant message appended", async () => {
    const { chat } = mockChat({
      content: null,
      toolCalls: [call("start_timer")],
    });
    const outcome = await runToolLoop({
      userId: "u1",
      messages: baseMessages,
      clientTools: [clientTool],
      serverTools: [],
      chat,
    });
    expect(outcome.kind).toBe("client_calls");
    if (outcome.kind !== "client_calls") throw new Error("unreachable");
    expect(outcome.calls.map((c) => c.function.name)).toEqual(["start_timer"]);
    expect(outcome.messages.at(-1)).toMatchObject({
      role: "assistant",
      tool_calls: [{ function: { name: "start_timer" } }],
    });
    // Original array untouched.
    expect(baseMessages).toHaveLength(2);
  });

  it("executes server tools inline and loops until speech", async () => {
    const handler = vi.fn().mockResolvedValue({ count: 2 });
    const { chat, seenMessages } = mockChat(
      { content: null, toolCalls: [call("deals_summary", "call_a", '{"days":5}')] },
      { content: "Two deals found.", toolCalls: [] }
    );

    const outcome = await runToolLoop({
      userId: "u1",
      messages: baseMessages,
      clientTools: [clientTool],
      serverTools: [serverTool(handler)],
      chat,
    });

    expect(handler).toHaveBeenCalledWith("u1", { days: 5 });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(outcome).toMatchObject({ kind: "speech", speech: "Two deals found." });
    // Second LLM call saw the tool result.
    expect(seenMessages[1].at(-1)).toEqual({
      role: "tool",
      tool_call_id: "call_a",
      content: '{"count":2}',
    });
  });

  it("feeds server tool errors back to the model instead of throwing", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("db down"));
    const { chat, seenMessages } = mockChat(
      { content: null, toolCalls: [call("deals_summary")] },
      { content: "I couldn't check deals right now.", toolCalls: [] }
    );

    const outcome = await runToolLoop({
      userId: "u1",
      messages: baseMessages,
      clientTools: [],
      serverTools: [serverTool(handler)],
      chat,
    });

    expect(outcome.kind).toBe("speech");
    expect(seenMessages[1].at(-1)).toMatchObject({
      role: "tool",
      content: "Error: db down",
    });
  });

  it("reports hallucinated tool names back to the model", async () => {
    const { chat, seenMessages } = mockChat(
      { content: null, toolCalls: [call("no_such_tool")] },
      { content: "Sorry, I can't do that.", toolCalls: [] }
    );

    const outcome = await runToolLoop({
      userId: "u1",
      messages: baseMessages,
      clientTools: [clientTool],
      serverTools: [],
      chat,
    });

    expect(outcome.kind).toBe("speech");
    expect(seenMessages[1].at(-1)).toMatchObject({
      role: "tool",
      content: 'Error: unknown tool "no_such_tool".',
    });
  });

  it("mixed batch: executes server tools, returns client calls with results already appended", async () => {
    const handler = vi.fn().mockResolvedValue("ok");
    const { chat } = mockChat({
      content: null,
      toolCalls: [call("deals_summary", "call_srv"), call("start_timer", "call_cli")],
    });

    const outcome = await runToolLoop({
      userId: "u1",
      messages: baseMessages,
      clientTools: [clientTool],
      serverTools: [serverTool(handler)],
      chat,
    });

    expect(outcome.kind).toBe("client_calls");
    if (outcome.kind !== "client_calls") throw new Error("unreachable");
    expect(outcome.calls.map((c) => c.id)).toEqual(["call_cli"]);
    expect(outcome.messages.at(-1)).toEqual({
      role: "tool",
      tool_call_id: "call_srv",
      content: "ok",
    });
  });

  it("gives up with fallback speech after maxTurns of server-only loops", async () => {
    const handler = vi.fn().mockResolvedValue("ok");
    const { chat } = mockChat({
      content: null,
      toolCalls: [call("deals_summary")],
    });

    const outcome = await runToolLoop({
      userId: "u1",
      messages: baseMessages,
      clientTools: [],
      serverTools: [serverTool(handler)],
      chat,
      maxTurns: 2,
    });

    expect(chat).toHaveBeenCalledTimes(2);
    expect(outcome.kind).toBe("speech");
    if (outcome.kind !== "speech") throw new Error("unreachable");
    expect(outcome.speech).toContain("too many steps");
  });
});
