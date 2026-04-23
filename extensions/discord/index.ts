import {
  defineBundledChannelEntry,
  loadBundledEntryExportSync,
} from "openclaw/plugin-sdk/channel-entry-contract";

type DiscordSubagentHooksModule = typeof import("./subagent-hooks-api.js");

function loadDiscordSubagentHook<TExportName extends keyof DiscordSubagentHooksModule>(
  exportName: TExportName,
): DiscordSubagentHooksModule[TExportName] {
  return loadBundledEntryExportSync<DiscordSubagentHooksModule[TExportName]>(import.meta.url, {
    specifier: "./subagent-hooks-api.js",
    exportName,
  });
}

export default defineBundledChannelEntry({
  id: "discord",
  name: "Discord",
  description: "Discord channel plugin",
  importMetaUrl: import.meta.url,
  plugin: {
    specifier: "./channel-plugin-api.js",
    exportName: "discordPlugin",
  },
  runtime: {
    specifier: "./runtime-api.js",
    exportName: "setDiscordRuntime",
  },
  accountInspect: {
    specifier: "./account-inspect-api.js",
    exportName: "inspectDiscordReadOnlyAccount",
  },
  registerFull(api) {
    api.on("subagent_spawning", async (event) => {
      return await loadDiscordSubagentHook("handleDiscordSubagentSpawning")(api, event);
    });
    api.on("subagent_ended", async (event) => {
      loadDiscordSubagentHook("handleDiscordSubagentEnded")(event);
    });
    api.on("subagent_delivery_target", async (event) => {
      return loadDiscordSubagentHook("handleDiscordSubagentDeliveryTarget")(event);
    });
  },
});
