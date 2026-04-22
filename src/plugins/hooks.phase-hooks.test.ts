import { beforeEach, describe, expect, it } from "vitest";
import { createHookRunner } from "./hooks.js";
import { addStaticTestHooks } from "./hooks.test-helpers.js";
import { createEmptyPluginRegistry, type PluginRegistry } from "./registry.js";
import type {
  PluginHookAfterModelResponseResult,
  PluginHookBeforeModelResolveResult,
  PluginHookBeforePromptBuildResult,
} from "./types.js";

describe("phase hooks merger", () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = createEmptyPluginRegistry();
  });

  async function runPhaseHook(params: {
    hookName: "before_model_resolve" | "before_prompt_build";
    hooks: ReadonlyArray<{
      pluginId: string;
      result: PluginHookBeforeModelResolveResult | PluginHookBeforePromptBuildResult;
      priority?: number;
    }>;
  }) {
    addStaticTestHooks(registry, {
      hookName: params.hookName,
      hooks: [...params.hooks],
    });
    const runner = createHookRunner(registry);
    if (params.hookName === "before_model_resolve") {
      return await runner.runBeforeModelResolve({ prompt: "test" }, {});
    }
    return await runner.runBeforePromptBuild({ prompt: "test", messages: [] }, {});
  }

  async function expectPhaseHookMerge(params: {
    hookName: "before_model_resolve" | "before_prompt_build";
    hooks: ReadonlyArray<{
      pluginId: string;
      result: PluginHookBeforeModelResolveResult | PluginHookBeforePromptBuildResult;
      priority?: number;
    }>;
    expected: Record<string, unknown>;
  }) {
    const result = await runPhaseHook(params);
    expect(result).toEqual(expect.objectContaining(params.expected));
  }

  it.each([
    {
      name: "before_model_resolve keeps higher-priority override values",
      hookName: "before_model_resolve" as const,
      hooks: [
        { pluginId: "low", result: { modelOverride: "demo-low-priority-model" }, priority: 1 },
        {
          pluginId: "high",
          result: {
            modelOverride: "demo-high-priority-model",
            providerOverride: "demo-provider",
          },
          priority: 10,
        },
      ],
      expected: {
        modelOverride: "demo-high-priority-model",
        providerOverride: "demo-provider",
      },
    },
    {
      name: "before_prompt_build concatenates prependContext and preserves systemPrompt precedence",
      hookName: "before_prompt_build" as const,
      hooks: [
        {
          pluginId: "high",
          result: { prependContext: "context A", systemPrompt: "system A" },
          priority: 10,
        },
        {
          pluginId: "low",
          result: { prependContext: "context B", systemPrompt: "system B" },
          priority: 1,
        },
      ],
      expected: {
        prependContext: "context A\n\ncontext B",
        systemPrompt: "system A",
      },
    },
    {
      name: "before_prompt_build concatenates prependSystemContext and appendSystemContext",
      hookName: "before_prompt_build" as const,
      hooks: [
        {
          pluginId: "first",
          result: {
            prependSystemContext: "prepend A",
            appendSystemContext: "append A",
          },
          priority: 10,
        },
        {
          pluginId: "second",
          result: {
            prependSystemContext: "prepend B",
            appendSystemContext: "append B",
          },
          priority: 1,
        },
      ],
      expected: {
        prependSystemContext: "prepend A\n\nprepend B",
        appendSystemContext: "append A\n\nappend B",
      },
    },
  ] as const)("$name", async ({ hookName, hooks, expected }) => {
    await expectPhaseHookMerge({ hookName, hooks, expected });
  });
});

describe("after_model_response hook runner", () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = createEmptyPluginRegistry();
  });

  it("continues past empty follow-up requests until a meaningful request wins", async () => {
    addStaticTestHooks<PluginHookAfterModelResponseResult>(registry, {
      hookName: "after_model_response",
      hooks: [
        {
          pluginId: "empty",
          result: { requestFollowUpPass: { passInput: {} } },
          priority: 10,
        },
        {
          pluginId: "meaningful",
          result: {
            requestFollowUpPass: {
              passInput: {
                prependContext: "tighten",
              },
            },
          },
          priority: 1,
        },
      ],
    });

    const runner = createHookRunner(registry);
    const result = await runner.runAfterModelResponse(
      {
        runId: "run-1",
        sessionId: "session-1",
        provider: "openai",
        model: "gpt-test",
        passIndex: 1,
        assistantTexts: ["draft"],
      },
      {},
    );

    expect(result).toEqual({
      requestFollowUpPass: {
        passInput: {
          prependContext: "tighten",
        },
      },
    });
  });

  it("returns undefined when every follow-up request is empty", async () => {
    addStaticTestHooks<PluginHookAfterModelResponseResult>(registry, {
      hookName: "after_model_response",
      hooks: [
        {
          pluginId: "empty",
          result: { requestFollowUpPass: { passInput: {} } },
          priority: 10,
        },
      ],
    });

    const runner = createHookRunner(registry);
    const result = await runner.runAfterModelResponse(
      {
        runId: "run-1",
        sessionId: "session-1",
        provider: "openai",
        model: "gpt-test",
        passIndex: 1,
        assistantTexts: ["draft"],
      },
      {},
    );

    expect(result).toBeUndefined();
  });
});
