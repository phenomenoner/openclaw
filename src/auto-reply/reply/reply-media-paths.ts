import fs from "node:fs/promises";
import path from "node:path";
import { resolveSendableOutboundReplyParts } from "openclaw/plugin-sdk/reply-payload";
import { resolveSessionAgentId } from "../../agents/agent-scope.js";
import { resolvePathFromInput } from "../../agents/path-policy.js";
import { assertMediaNotDataUrl, resolveSandboxedMediaSource } from "../../agents/sandbox-paths.js";
import { ensureSandboxWorkspaceForSession } from "../../agents/sandbox.js";
import { resolveEffectiveToolFsWorkspaceOnly } from "../../agents/tool-fs-policy.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { logVerbose } from "../../globals.js";
import { MEDIA_MAX_BYTES, saveMediaSource } from "../../media/store.js";
import { resolveConfigDir } from "../../utils.js";
import type { ReplyPayload } from "../types.js";

const HTTP_URL_RE = /^https?:\/\//i;
const FILE_URL_RE = /^file:\/\//i;
const WINDOWS_DRIVE_RE = /^[a-zA-Z]:[\\/]/;
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const HAS_FILE_EXT_RE = /\.\w{1,10}$/;
const AGENT_STATE_MEDIA_DIRNAME = path.join(".openclaw", "media");
const MANAGED_GLOBAL_MEDIA_SUBDIRS = new Set(["outbound"]);
function resolveOversizeMediaHandoffDir(): string {
  return process.env.OPENCLAW_OVERSIZE_MEDIA_DIR?.trim() || "/workspace/openclaw-oversize-media";
}

type OversizeMediaHandoff = {
  originalPath: string;
  handoffPath: string;
  size: number;
};

function isFileUrl(value: string): boolean {
  return FILE_URL_RE.test(value);
}

function resolveLocalMediaFilesystemPath(media: string): string | null {
  if (isFileUrl(media)) {
    try {
      return new URL(media).pathname;
    } catch {
      return null;
    }
  }
  return path.isAbsolute(media) ? media : null;
}

function formatMediaSizeForUser(size: number): string {
  return `${(size / (1024 * 1024)).toFixed(1)}MB`;
}

async function moveOversizeMediaToWorkspace(
  mediaPath: string,
): Promise<OversizeMediaHandoff | null> {
  const stat = await fs.stat(mediaPath).catch(() => null);
  if (!stat?.isFile() || stat.size <= MEDIA_MAX_BYTES) {
    return null;
  }

  const handoffDir = resolveOversizeMediaHandoffDir();
  await fs.mkdir(handoffDir, { recursive: true, mode: 0o755 });
  const parsed = path.parse(mediaPath);
  const handoffPath = path.join(handoffDir, `${parsed.name}-${Date.now()}${parsed.ext || ""}`);
  if (path.resolve(mediaPath) !== path.resolve(handoffPath)) {
    await fs.copyFile(mediaPath, handoffPath);
  }

  return {
    originalPath: mediaPath,
    handoffPath,
    size: stat.size,
  };
}

function appendOversizeMediaNotes(
  text: string | undefined,
  notes: readonly string[],
): string | undefined {
  if (notes.length === 0) {
    return text;
  }
  const existing = text?.trim();
  const noteBlock = notes.join("\n");
  return existing ? `${existing}\n\n${noteBlock}` : noteBlock;
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isManagedGlobalReplyMediaPath(candidate: string): boolean {
  const globalMediaRoot = path.join(resolveConfigDir(), "media");
  const relative = path.relative(path.resolve(globalMediaRoot), path.resolve(candidate));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return false;
  }
  const firstSegment = relative.split(path.sep)[0] ?? "";
  return MANAGED_GLOBAL_MEDIA_SUBDIRS.has(firstSegment) || firstSegment.startsWith("tool-");
}

function isAllowedAbsoluteReplyMediaPath(params: {
  candidate: string;
  workspaceDir: string;
  sandboxRoot?: string;
}): boolean {
  if (isManagedGlobalReplyMediaPath(params.candidate)) {
    return true;
  }
  const volatileRoots = [params.workspaceDir, params.sandboxRoot]
    .filter((root): root is string => Boolean(root))
    .map((root) => path.join(path.resolve(root), AGENT_STATE_MEDIA_DIRNAME));
  return volatileRoots.some((root) => isPathInside(root, params.candidate));
}

function isLikelyLocalMediaSource(media: string): boolean {
  return (
    FILE_URL_RE.test(media) ||
    media.startsWith("/") ||
    media.startsWith("./") ||
    media.startsWith("../") ||
    media.startsWith("~") ||
    WINDOWS_DRIVE_RE.test(media) ||
    media.startsWith("\\\\") ||
    (!SCHEME_RE.test(media) &&
      (media.includes("/") || media.includes("\\") || HAS_FILE_EXT_RE.test(media)))
  );
}

function getPayloadMediaList(payload: ReplyPayload): string[] {
  return resolveSendableOutboundReplyParts(payload).mediaUrls;
}

export function createReplyMediaPathNormalizer(params: {
  cfg: OpenClawConfig;
  sessionKey?: string;
  workspaceDir: string;
}): (payload: ReplyPayload) => Promise<ReplyPayload> {
  const agentId = params.sessionKey
    ? resolveSessionAgentId({ sessionKey: params.sessionKey, config: params.cfg })
    : undefined;
  const workspaceOnly = resolveEffectiveToolFsWorkspaceOnly({
    cfg: params.cfg,
    agentId,
  });
  let sandboxRootPromise: Promise<string | undefined> | undefined;
  const persistedMediaBySource = new Map<string, Promise<string>>();

  const resolveSandboxRoot = async (): Promise<string | undefined> => {
    if (!sandboxRootPromise) {
      sandboxRootPromise = ensureSandboxWorkspaceForSession({
        config: params.cfg,
        sessionKey: params.sessionKey,
        workspaceDir: params.workspaceDir,
      }).then((sandbox) => sandbox?.workspaceDir);
    }
    return await sandboxRootPromise;
  };

  const persistVolatileAgentMedia = async (media: string): Promise<string> => {
    if (!path.isAbsolute(media)) {
      return media;
    }
    const sandboxRoot = await resolveSandboxRoot();
    const volatileRoots = [params.workspaceDir, sandboxRoot]
      .filter((root): root is string => Boolean(root))
      .map((root) => path.join(path.resolve(root), AGENT_STATE_MEDIA_DIRNAME));
    if (!volatileRoots.some((root) => isPathInside(root, media))) {
      return media;
    }
    const cached = persistedMediaBySource.get(media);
    if (cached) {
      return await cached;
    }
    const persistPromise = saveMediaSource(media, undefined, "outbound")
      .then((saved) => saved.path)
      .catch((err) => {
        persistedMediaBySource.delete(media);
        throw err;
      });
    persistedMediaBySource.set(media, persistPromise);
    try {
      return await persistPromise;
    } catch (err) {
      logVerbose(`failed to persist volatile reply media ${media}: ${String(err)}`);
      return media;
    }
  };

  const normalizeMediaSource = async (raw: string): Promise<string> => {
    const media = raw.trim();
    if (!media) {
      return media;
    }
    assertMediaNotDataUrl(media);
    if (HTTP_URL_RE.test(media)) {
      return media;
    }
    const sandboxRoot = await resolveSandboxRoot();
    if (sandboxRoot) {
      try {
        return await resolveSandboxedMediaSource({
          media,
          sandboxRoot,
        });
      } catch (err) {
        if (!isLikelyLocalMediaSource(media) || FILE_URL_RE.test(media)) {
          throw err;
        }
        if (workspaceOnly) {
          throw err;
        }
        if (!path.isAbsolute(media)) {
          return resolvePathFromInput(media, params.workspaceDir);
        }
        if (
          isAllowedAbsoluteReplyMediaPath({
            candidate: media,
            workspaceDir: params.workspaceDir,
            sandboxRoot,
          })
        ) {
          return media;
        }
        throw new Error(
          "Absolute host-local MEDIA paths are blocked in normal replies. Use a safe relative path or the message tool.",
          { cause: err },
        );
      }
    }
    if (!isLikelyLocalMediaSource(media)) {
      return media;
    }
    if (FILE_URL_RE.test(media)) {
      throw new Error(
        "Absolute host-local MEDIA file URLs are blocked in normal replies. Use a safe relative path or the message tool.",
      );
    }
    if (!path.isAbsolute(media)) {
      return resolvePathFromInput(media, params.workspaceDir);
    }
    if (
      isAllowedAbsoluteReplyMediaPath({
        candidate: media,
        workspaceDir: params.workspaceDir,
        sandboxRoot,
      })
    ) {
      return media;
    }
    throw new Error(
      "Absolute host-local MEDIA paths are blocked in normal replies. Use a safe relative path or the message tool.",
    );
  };

  return async (payload) => {
    const mediaList = getPayloadMediaList(payload);
    if (mediaList.length === 0) {
      return payload;
    }

    const normalizedMedia: string[] = [];
    const oversizeNotes: string[] = [];
    const seen = new Set<string>();
    for (const media of mediaList) {
      let normalized: string;
      try {
        normalized = await persistVolatileAgentMedia(await normalizeMediaSource(media));
      } catch (err) {
        logVerbose(`dropping blocked reply media ${media}: ${String(err)}`);
        continue;
      }
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);

      const mediaPath = resolveLocalMediaFilesystemPath(normalized);
      if (mediaPath) {
        const handoff = await moveOversizeMediaToWorkspace(mediaPath).catch((err) => {
          logVerbose(`failed to hand off oversized media ${mediaPath}: ${String(err)}`);
          return null;
        });
        if (handoff) {
          oversizeNotes.push(
            `Media too large for chat delivery, saved to ${handoff.handoffPath} (${formatMediaSizeForUser(handoff.size)}).`,
          );
          continue;
        }
      }

      normalizedMedia.push(normalized);
    }

    if (normalizedMedia.length === 0) {
      return {
        ...payload,
        text: appendOversizeMediaNotes(payload.text, oversizeNotes),
        mediaUrl: undefined,
        mediaUrls: undefined,
      };
    }

    return {
      ...payload,
      text: appendOversizeMediaNotes(payload.text, oversizeNotes),
      mediaUrl: normalizedMedia[0],
      mediaUrls: normalizedMedia,
    };
  };
}
