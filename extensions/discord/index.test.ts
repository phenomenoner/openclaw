import { afterEach, describe, expect, it, vi } from "vitest";
import { assertBundledChannelEntries } from "../../test/helpers/bundled-channel-entry.ts";
import { importFreshModule } from "../../test/helpers/import-fresh.ts";
import entry from "./index.js";
import setupEntry from "./setup-entry.js";

const loadBundledEntryExportSyncMock = vi.hoisted(() => vi.fn());

vi.mock("openclaw/plugin-sdk/channel-entry-contract", () => ({
  defineBundledChannelEntry: (options: unknown) => options,
  loadBundledEntryExportSync: loadBundledEntryExportSyncMock,
}));

afterEach(() => {
  vi.resetModules();
  loadBundledEntryExportSyncMock.mockReset();
});

describe("discord bundled entries", () => {
  assertBundledChannelEntries({
    entry,
    expectedId: "discord",
    expectedName: "Discord",
    setupEntry,
  });
});

describe("discord bundled entry subagent hooks", () => {
  it("loads subagent hooks through the bundled entry loader on demand", async () => {
    const handleDiscordSubagentSpawning = vi.fn(async () => ({ status: "ok" as const }));
    const handleDiscordSubagentEnded = vi.fn();
    const handleDiscordSubagentDeliveryTarget = vi.fn(() => ({
      origin: { channel: "discord" as const, to: "channel:thread-1" },
    }));

    loadBundledEntryExportSyncMock.mockImplementation(
      (_importMetaUrl, reference: { exportName?: string }) => {
        switch (reference.exportName) {
          case "handleDiscordSubagentSpawning":
            return handleDiscordSubagentSpawning;
          case "handleDiscordSubagentEnded":
            return handleDiscordSubagentEnded;
          case "handleDiscordSubagentDeliveryTarget":
            return handleDiscordSubagentDeliveryTarget;
          default:
            throw new Error(`unexpected export ${String(reference.exportName)}`);
        }
      },
    );

    const entry = await importFreshModule<{
      default: {
        registerFull(api: { on: (event: string, handler: (...args: any[]) => any) => void }): void;
      };
    }>(import.meta.url, "./index.ts?scope=subagent-hooks-loader");

    const handlers = new Map<string, (...args: any[]) => any>();
    const api = {
      config: {},
      on: vi.fn((event: string, handler: (...args: any[]) => any) => {
        handlers.set(event, handler);
      }),
    };

    entry.default.registerFull(api);

    expect(api.on).toHaveBeenCalledTimes(3);
    expect(loadBundledEntryExportSyncMock).not.toHaveBeenCalled();

    const spawnEvent = { childSessionKey: "child-1", agentId: "worker" };
    await expect(handlers.get("subagent_spawning")?.(spawnEvent)).resolves.toEqual({
      status: "ok",
    });
    expect(handleDiscordSubagentSpawning).toHaveBeenCalledWith(api, spawnEvent);

    const endedEvent = { targetSessionKey: "child-1" };
    await handlers.get("subagent_ended")?.(endedEvent);
    expect(handleDiscordSubagentEnded).toHaveBeenCalledWith(endedEvent);

    const deliveryEvent = { childSessionKey: "child-1", expectsCompletionMessage: true };
    await expect(handlers.get("subagent_delivery_target")?.(deliveryEvent)).resolves.toEqual({
      origin: { channel: "discord", to: "channel:thread-1" },
    });
    expect(handleDiscordSubagentDeliveryTarget).toHaveBeenCalledWith(deliveryEvent);

    expect(loadBundledEntryExportSyncMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("extensions/discord/index.ts?scope=subagent-hooks-loader"),
      {
        specifier: "./subagent-hooks-api.js",
        exportName: "handleDiscordSubagentSpawning",
      },
    );
    expect(loadBundledEntryExportSyncMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("extensions/discord/index.ts?scope=subagent-hooks-loader"),
      {
        specifier: "./subagent-hooks-api.js",
        exportName: "handleDiscordSubagentEnded",
      },
    );
    expect(loadBundledEntryExportSyncMock).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("extensions/discord/index.ts?scope=subagent-hooks-loader"),
      {
        specifier: "./subagent-hooks-api.js",
        exportName: "handleDiscordSubagentDeliveryTarget",
      },
    );
  });
});
