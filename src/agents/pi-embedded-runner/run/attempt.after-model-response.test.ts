import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupTempPaths,
  createContextEngineAttemptRunner,
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
          { role: "assistant", content: `assistant:${prompt}`, timestamp: prompts.length + 1 },
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
          { role: "assistant", content: `assistant:${prompt}`, timestamp: prompts.length + 1 },
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

  it("delivers only the final assistant message when a follow-up pass runs", async () => {
    const delivered: string[] = [];
    let subscriptionCallbacks:
      | {
          onBlockReply?: (payload: { text?: string }) => void | Promise<void>;
          onBlockReplyFlush?: () => void | Promise<void>;
        }
      | undefined;

    resetEmbeddedAttemptHarness({
      subscribeImpl: (params) => {
        subscriptionCallbacks = {
          onBlockReply: params.onBlockReply,
          onBlockReplyFlush: params.onBlockReplyFlush,
        };
        return {
          assistantTexts: [],
          toolMetas: [],
          unsubscribe: () => {},
          setTerminalLifecycleMeta: () => {},
          waitForCompactionRetry: async () => {},
          getMessagingToolSentTexts: () => [],
          getMessagingToolSentMediaUrls: () => [],
          getMessagingToolSentTargets: () => [],
          getSuccessfulCronAdds: () => 0,
          getReplayState: () => ({ replayInvalid: false, hadPotentialSideEffects: false }),
          didSendViaMessagingTool: () => false,
          didSendDeterministicApprovalPrompt: () => false,
          getLastToolError: () => undefined,
          getUsageTotals: () => undefined,
          getCompactionCount: () => 0,
          getItemLifecycle: () => ({ startedCount: 0, completedCount: 0, activeCount: 0 }),
          isCompacting: () => false,
          isCompactionInFlight: () => false,
        };
      },
    });

    const hookRunner = {
      hasHooks: vi.fn((hookName: string) => hookName === "after_model_response"),
      runAfterModelResponse: vi.fn(async ({ passIndex }: { passIndex: number }) =>
        passIndex === 1
          ? {
              requestFollowUpPass: {
                passInput: {
                  prependContext: "finalize the answer",
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
      attemptOverrides: {
        onBlockReply: async (payload) => {
          if (payload.text) {
            delivered.push(payload.text);
          }
        },
      },
      sessionPrompt: async (session, prompt) => {
        await subscriptionCallbacks?.onBlockReply?.({ text: `assistant:${prompt}` });
        await subscriptionCallbacks?.onBlockReplyFlush?.();
        session.messages = [
          ...session.messages,
          {
            role: "assistant",
            content: `assistant:${prompt}`,
            timestamp: session.messages.length + 1,
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

    expect(delivered).toEqual(["assistant:finalize the answer"]);
    expect(hookRunner.runAfterModelResponse).toHaveBeenCalledTimes(2);
  });
});
