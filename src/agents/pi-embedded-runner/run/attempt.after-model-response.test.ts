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

  it("executes one bounded follow-up pass when requested by the hook", async () => {
    const prompts: string[] = [];
    const hookRunner = {
      hasHooks: vi.fn((hookName: string) => hookName === "after_model_response"),
      runAfterModelResponse: vi.fn(async ({ passIndex }: { passIndex: number }) =>
        passIndex === 1
          ? {
              requestFollowUpPass: {
                reason: "tighten",
                passInput: {
                  prependContext: "Follow-up tighten pass",
                  appendSystemContext: "Double-check the previous answer before finalizing.",
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

    expect(prompts).toEqual(["hello", "Follow-up tighten pass"]);
    expect(hookRunner.runAfterModelResponse).toHaveBeenCalledTimes(2);
    expect(hookRunner.runAfterModelResponse).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        passIndex: 1,
        lastAssistant: expect.objectContaining({ content: "assistant:hello" }),
      }),
      expect.any(Object),
    );
    expect(hookRunner.runAfterModelResponse).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        passIndex: 2,
        lastAssistant: expect.objectContaining({ content: "assistant:Follow-up tighten pass" }),
      }),
      expect.any(Object),
    );
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
  });

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

    expect(prompts).toEqual(["hello", "another pass"]);
    expect(hookRunner.runAfterModelResponse).toHaveBeenCalledTimes(2);
  });
});
