import fs from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { CronService } from "./service.js";
import { createCronStoreHarness, createNoopLogger } from "./service.test-harness.js";

const harness = createCronStoreHarness({ prefix: "openclaw-cron-manual-run-" });
const logger = createNoopLogger();

describe("CronService manual run store reload", () => {
  it("reloads jobs.json before a manual run so payload edits are respected", async () => {
    const { storePath, cleanup } = await harness.makeStorePath();
    const runIsolatedAgentJob = vi.fn(
      async ({ job }: { job: { payload: { thinking?: string } } }) => ({
        status: "ok" as const,
        summary: job.payload.thinking ?? "missing",
      }),
    );

    const cron = new CronService({
      storePath,
      cronEnabled: true,
      log: logger,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeatNow: vi.fn(),
      runIsolatedAgentJob,
    });

    try {
      await cron.start();
      const job = await cron.add({
        name: "manual reload regression",
        enabled: true,
        deleteAfterRun: false,
        schedule: { kind: "at", at: new Date(Date.now() + 60_000).toISOString() },
        sessionTarget: "isolated",
        wakeMode: "next-heartbeat",
        payload: { kind: "agentTurn", message: "run once", thinking: "low" },
        delivery: { mode: "none" },
      });

      const raw = JSON.parse(await fs.readFile(storePath, "utf-8")) as {
        jobs: Array<{ id: string; payload: { thinking?: string } }>;
      };
      const target = raw.jobs.find((entry) => entry.id === job.id);
      expect(target).toBeTruthy();
      if (!target) {
        throw new Error("job missing from persisted store");
      }
      target.payload.thinking = "medium";
      await fs.writeFile(storePath, JSON.stringify(raw, null, 2), "utf-8");

      const res = await cron.run(job.id, "force");
      expect(res).toEqual({ ok: true, ran: true });
      expect(runIsolatedAgentJob).toHaveBeenCalledTimes(1);
      expect(runIsolatedAgentJob.mock.calls[0]?.[0]?.job?.payload?.thinking).toBe("medium");
    } finally {
      cron.stop();
      await cleanup();
    }
  });
});
