import { describe, expect, it } from "vitest";
import {
  resolveSubagentAnnounceTimeoutMs,
  resolveSubagentCompletionAnnounceTimeoutMs,
  runAnnounceDeliveryWithRetry,
} from "./subagent-announce-delivery.js";
import { resolveAnnounceOrigin } from "./subagent-announce-origin.js";

describe("subagent announce delivery timeout helpers", () => {
  it("caps completion announce timeout below the general announce timeout", () => {
    const cfg = {
      agents: {
        defaults: {
          subagents: {
            announceTimeoutMs: 120_000,
          },
        },
      },
    };

    expect(resolveSubagentAnnounceTimeoutMs(cfg)).toBe(120_000);
    expect(resolveSubagentCompletionAnnounceTimeoutMs(cfg)).toBe(30_000);
  });

  it("preserves lower configured completion announce timeout", () => {
    const cfg = {
      agents: {
        defaults: {
          subagents: {
            announceTimeoutMs: 15_000,
          },
        },
      },
    };

    expect(resolveSubagentCompletionAnnounceTimeoutMs(cfg)).toBe(15_000);
  });

  it("honors per-call retry delays", async () => {
    let attempts = 0;

    await expect(
      runAnnounceDeliveryWithRetry({
        operation: "test completion announce",
        retryDelaysMs: [1],
        run: async () => {
          attempts += 1;
          throw new Error("gateway timeout after 30000ms");
        },
      }),
    ).rejects.toThrow("gateway timeout after 30000ms");

    expect(attempts).toBe(2);
  });
});

describe("resolveAnnounceOrigin telegram forum topics", () => {
  it("preserves stored forum topic thread ids when requester origin omits one for the same chat", () => {
    expect(
      resolveAnnounceOrigin(
        {
          lastChannel: "telegram",
          lastTo: "telegram:-1001234567890:topic:99",
          lastThreadId: 99,
        },
        {
          channel: "telegram",
          to: "telegram:-1001234567890",
        },
      ),
    ).toEqual({
      channel: "telegram",
      to: "telegram:-1001234567890",
      threadId: 99,
    });
  });

  it("preserves stored forum topic thread ids for legacy group-prefixed requester targets", () => {
    expect(
      resolveAnnounceOrigin(
        {
          lastChannel: "telegram",
          lastTo: "telegram:-1001234567890:topic:99",
          lastThreadId: 99,
        },
        {
          channel: "telegram",
          to: "group:-1001234567890",
        },
      ),
    ).toEqual({
      channel: "telegram",
      to: "group:-1001234567890",
      threadId: 99,
    });
  });

  it("still strips stale thread ids when the stored telegram route points at a different chat", () => {
    expect(
      resolveAnnounceOrigin(
        {
          lastChannel: "telegram",
          lastTo: "telegram:-1009999999999:topic:99",
          lastThreadId: 99,
        },
        {
          channel: "telegram",
          to: "telegram:-1001234567890",
        },
      ),
    ).toEqual({
      channel: "telegram",
      to: "telegram:-1001234567890",
    });
  });
});
