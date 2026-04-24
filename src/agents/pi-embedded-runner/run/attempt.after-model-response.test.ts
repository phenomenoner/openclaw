import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupTempPaths,
  createContextEngineAttemptRunner,
  createSubscriptionMock,
  getHoisted,
  resetEmbeddedAttemptHarness,
} from "./attempt.spawn-workspace.test-support.js";

const hoisted = getHoisted();

describe("runEmbeddedAttempt after_model_response follow-up passes", () => {
  const tempPaths: string[] = [];

  beforeEach(() => {
    resetEmbeddedAttemptHarness();
    hoisted.getGlobalHookRunnerMock.mockReset().mockReturnValue(undefined);
  });

  afterEach(async () => {
    hoisted.getGlobalHookRunnerMock.mockReset().mockReturnValue(undefined);
    await cleanupTempPaths(tempPaths);
  });

  it("ignores empty follow-up requests and stays on the original single pass", async () => {
    const prompts: string[] = [];
    const hookRunner = {
      hasHooks: vi.fn((hookName: string) => hookName === "after_model_response"),
      runAfterModelResponse: vi.fn(async () => ({
        requestFollowUpPass: {
          passInput: {
            prependContext: "   ",
            appendSystemContext: "\n\n",
          },
        },
      })),
    };
    hoisted.getGlobalHookRunnerMock.mockReturnValue(hookRunner);

    await createContextEngineAttemptRunner({
      sessionKey: "agent:main",
      tempPaths,
      sessionPrompt: async (session, prompt) => {
        prompts.push(prompt);
        session.messages = [
          ...session.messages,
          {
            role: "assistant",
            content: `assistant:${prompt}`,
            timestamp: prompts.length + 1,
          },
        ];
      },
      contextEngine: {
        assemble: async ({ messages }) => ({
          messages,
          estimatedTokens: 1,
        }),
      },
    });

    expect(prompts).toEqual(["hello"]);
    expect(hookRunner.runAfterModelResponse).toHaveBeenCalledTimes(1);
  }, 120000);

  it("fails closed on over-ceiling follow-up requests by refusing a third pass", async () => {
    const prompts: string[] = [];
    const hookRunner = {
      hasHooks: vi.fn((hookName: string) => hookName === "after_model_response"),
      runAfterModelResponse: vi.fn(async () => ({
        requestFollowUpPass: {
          passInput: {
            prependContext: "another pass",
          },
        },
      })),
    };
    hoisted.getGlobalHookRunnerMock.mockReturnValue(hookRunner);

    await createContextEngineAttemptRunner({
      sessionKey: "agent:main",
      tempPaths,
      sessionPrompt: async (session, prompt) => {
        prompts.push(prompt);
        session.messages = [
          ...session.messages,
          {
            role: "assistant",
            content: `assistant:${prompt}`,
            timestamp: prompts.length + 1,
          },
        ];
      },
      contextEngine: {
        assemble: async ({ messages }) => ({
          messages,
          estimatedTokens: 1,
        }),
      },
    });

    expect(prompts).toEqual(["hello", "another pass"]);
    expect(hookRunner.runAfterModelResponse).toHaveBeenCalledTimes(2);
    expect(hookRunner.runAfterModelResponse).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ passIndex: 2 }),
      expect.any(Object),
    );
  });

  it("allows a verifier-heavy third pass when the hook raises maxPassIndex", async () => {
    const prompts: string[] = [];
    const hookRunner = {
      hasHooks: vi.fn((hookName: string) => hookName === "after_model_response"),
      runAfterModelResponse: vi.fn(async ({ passIndex }: { passIndex: number }) =>
        passIndex < 3
          ? {
              requestFollowUpPass: {
                maxPassIndex: 3,
                passInput: {
                  prependContext: `pass-${passIndex + 1}`,
                },
              },
            }
          : undefined,
      ),
    };
    hoisted.getGlobalHookRunnerMock.mockReturnValue(hookRunner);

    await createContextEngineAttemptRunner({
      sessionKey: "agent:main",
      tempPaths,
      sessionPrompt: async (session, prompt) => {
        prompts.push(prompt);
        session.messages = [
          ...session.messages,
          {
            role: "assistant",
            content: `assistant:${prompt}`,
            timestamp: prompts.length + 1,
          },
        ];
      },
      contextEngine: {
        assemble: async ({ messages }) => ({
          messages,
          estimatedTokens: 1,
        }),
      },
    });

    expect(prompts).toEqual(["hello", "pass-2", "pass-3"]);
    expect(hookRunner.runAfterModelResponse).toHaveBeenCalledTimes(3);
  });

  it("does not run follow-up hooks for startup /new reset prompts", async () => {
    const prompts: string[] = [];
    const hookRunner = {
      hasHooks: vi.fn((hookName: string) => hookName === "after_model_response"),
      runAfterModelResponse: vi.fn(async () => ({
        requestFollowUpPass: {
          passInput: { prependContext: "should not run" },
        },
      })),
    };
    hoisted.getGlobalHookRunnerMock.mockReturnValue(hookRunner);

    await createContextEngineAttemptRunner({
      sessionKey: "agent:main",
      tempPaths,
      attemptOverrides: {
        prompt:
          "[Startup context loaded by runtime]\nA new session was started via /new or /reset.",
        trigger: "user",
      },
      sessionPrompt: async (session, prompt) => {
        prompts.push(prompt);
        session.messages = [
          ...session.messages,
          {
            role: "assistant",
            content: "startup greeting",
            timestamp: prompts.length + 1,
          },
        ];
      },
      contextEngine: {
        assemble: async ({ messages }) => ({ messages, estimatedTokens: 1 }),
      },
    });

    expect(prompts).toEqual([
      "[Startup context loaded by runtime]\nA new session was started via /new or /reset.",
    ]);
    expect(hookRunner.runAfterModelResponse).not.toHaveBeenCalled();
  });

  it("does not run follow-up hooks when the pass produced no assistant draft", async () => {
    const prompts: string[] = [];
    const hookRunner = {
      hasHooks: vi.fn((hookName: string) => hookName === "after_model_response"),
      runAfterModelResponse: vi.fn(async () => ({
        requestFollowUpPass: {
          passInput: { prependContext: "should not run" },
        },
      })),
    };
    hoisted.getGlobalHookRunnerMock.mockReturnValue(hookRunner);

    await createContextEngineAttemptRunner({
      sessionKey: "agent:main",
      tempPaths,
      sessionPrompt: async (_session, prompt) => {
        prompts.push(prompt);
      },
      contextEngine: {
        assemble: async ({ messages }) => ({ messages, estimatedTokens: 1 }),
      },
    });

    expect(prompts).toEqual(["hello"]);
    expect(hookRunner.runAfterModelResponse).not.toHaveBeenCalled();
  });

  it("suppresses intermediate pass replies and transcript state until the terminal pass", async () => {
    const prompts: string[] = [];
    const blockReplies: string[] = [];
    const partialReplies: string[] = [];
    const assistantStarts: string[] = [];
    const subscription = createSubscriptionMock();
    let subscriptionParams:
      | Parameters<(typeof hoisted.subscribeEmbeddedPiSessionMock)["mockImplementation"]>[0]
      | undefined;
    let transcriptMessages = [{ role: "user", content: "seed", timestamp: 1 }];
    let leafEntry: {
      type: "message";
      id: string;
      parentId?: string;
      message: { role: "assistant" };
    } | null = null;

    hoisted.subscribeEmbeddedPiSessionMock.mockImplementation((params) => {
      subscriptionParams = params;
      return subscription;
    });
    hoisted.sessionManager.getLeafEntry.mockImplementation(() => leafEntry);
    hoisted.sessionManager.resetLeaf.mockImplementation(() => {
      leafEntry = null;
      transcriptMessages = [{ role: "user", content: "seed", timestamp: 1 }];
    });
    hoisted.sessionManager.buildSessionContext.mockImplementation(() => ({
      messages: transcriptMessages,
    }));

    const hookRunner = {
      hasHooks: vi.fn((hookName: string) => hookName === "after_model_response"),
      runAfterModelResponse: vi.fn(async ({ passIndex }: { passIndex: number }) =>
        passIndex === 1
          ? {
              requestFollowUpPass: {
                passInput: {
                  prependContext: "follow-up final pass",
                },
              },
            }
          : undefined,
      ),
    };
    hoisted.getGlobalHookRunnerMock.mockReturnValue(hookRunner);

    const result = await createContextEngineAttemptRunner({
      sessionKey: "agent:main",
      tempPaths,
      attemptOverrides: {
        onAssistantMessageStart: async () => {
          assistantStarts.push(`start:${prompts.length}`);
        },
        onPartialReply: async ({ text }) => {
          partialReplies.push(text ?? "");
        },
        onBlockReply: async ({ text }) => {
          blockReplies.push(text ?? "");
        },
      },
      sessionPrompt: async (session, prompt) => {
        prompts.push(prompt);
        const text = prompts.length === 1 ? "draft answer" : "final answer";
        await subscriptionParams?.onAssistantMessageStart?.();
        await subscriptionParams?.onPartialReply?.({ text: `partial:${text}` });
        await subscriptionParams?.onBlockReply?.({ text: `block:${text}` });
        subscription.assistantTexts.push(text);
        transcriptMessages = [
          ...session.messages,
          { role: "assistant", content: text, timestamp: prompts.length + 1 },
        ];
        session.messages = transcriptMessages;
        leafEntry = {
          type: "message",
          id: `assistant-${prompts.length}`,
          message: { role: "assistant" },
        };
      },
      contextEngine: {
        assemble: async ({ messages }) => ({
          messages,
          estimatedTokens: 1,
        }),
      },
    });

    expect(prompts).toEqual(["hello", "follow-up final pass"]);
    expect(assistantStarts).toEqual(["start:2"]);
    expect(partialReplies).toEqual(["partial:final answer"]);
    expect(blockReplies).toEqual(["block:final answer"]);
    expect(subscription.assistantTexts).toEqual(["final answer"]);
    expect(result.assistantTexts).toEqual(["final answer"]);
    expect(result.messagesSnapshot).toEqual([
      { role: "user", content: "seed", timestamp: 1 },
      { role: "assistant", content: "final answer", timestamp: 3 },
    ]);
    expect(hoisted.sessionManager.resetLeaf).toHaveBeenCalledTimes(2);
  });

  it("keeps follow-up pass input delta-only without reattaching ambient user-turn context", async () => {
    const prompts: string[] = [];
    const systemPrompts: Array<string | undefined> = [];
    const ambientPrompt = [
      "[ambient-context-a] must not be repeated",
      "[ambient-context-b] conversation metadata",
      "[ambient-context-c] external relay metadata",
      "[ambient-context-d] async relay envelope",
      "hello",
    ].join("\n");
    const followUpDelta = "Follow-up delta only: tighten the previous draft.";
    const hookRunner = {
      hasHooks: vi.fn((hookName: string) => hookName === "after_model_response"),
      runAfterModelResponse: vi.fn(async ({ passIndex }: { passIndex: number }) =>
        passIndex === 1
          ? {
              requestFollowUpPass: {
                passInput: {
                  prependContext: followUpDelta,
                  appendSystemContext: "Follow-up system delta only.",
                },
              },
            }
          : undefined,
      ),
    };
    hoisted.getGlobalHookRunnerMock.mockReturnValue(hookRunner);

    const assemble = vi.fn(async ({ messages }) => ({
      messages,
      estimatedTokens: 1,
    }));

    await createContextEngineAttemptRunner({
      sessionKey: "agent:main",
      tempPaths,
      attemptOverrides: {
        prompt: ambientPrompt,
      },
      sessionPrompt: async (session, prompt) => {
        prompts.push(prompt);
        systemPrompts.push(session.agent.state.systemPrompt);
        session.messages = [
          ...session.messages,
          {
            role: "assistant",
            content: `assistant draft for ${prompt}`,
            timestamp: prompts.length + 1,
          },
        ];
      },
      contextEngine: {
        assemble,
      },
    });

    expect(prompts).toEqual([ambientPrompt, followUpDelta]);
    expect(assemble).toHaveBeenCalledTimes(1);
    expect(assemble).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: ambientPrompt,
      }),
    );

    const secondPromptAndSystem = [prompts[1], systemPrompts[1]].join("\n");
    expect(secondPromptAndSystem).toContain(followUpDelta);
    expect(secondPromptAndSystem).toContain("Follow-up system delta only.");
    expect(secondPromptAndSystem).not.toContain("[ambient-context-a]");
    expect(secondPromptAndSystem).not.toContain("[ambient-context-b]");
    expect(secondPromptAndSystem).not.toContain("[ambient-context-c]");
    expect(secondPromptAndSystem).not.toContain("[ambient-context-d]");
  });
});
