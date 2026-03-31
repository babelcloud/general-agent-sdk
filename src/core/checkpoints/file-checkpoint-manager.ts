import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { GeneralAgentFileCheckpoint } from "../../public/types.js";

export type FileCheckpointTarget = {
  absolutePath: string;
  displayPath: string;
};

type FileCheckpointSnapshot = {
  absolutePath: string;
  displayPath: string;
  existedBefore: boolean;
  contents: Buffer | null;
};

type FileCheckpointRecord = {
  checkpoint: GeneralAgentFileCheckpoint;
  snapshots: FileCheckpointSnapshot[];
};

export type CapturedFileCheckpoint = FileCheckpointRecord;

export class GeneralAgentFileCheckpointManager {
  private readonly checkpoints: FileCheckpointRecord[] = [];

  async capture(params: {
    toolName: string;
    callId: string;
    files: FileCheckpointTarget[];
  }): Promise<CapturedFileCheckpoint> {
    const snapshots = await Promise.all(
      dedupeTargets(params.files).map(async (file) => {
        const existing = await readExistingFile(file.absolutePath);
        return {
          absolutePath: file.absolutePath,
          displayPath: file.displayPath,
          existedBefore: existing.existedBefore,
          contents: existing.contents,
        } satisfies FileCheckpointSnapshot;
      }),
    );

    return {
      checkpoint: {
        id: randomUUID(),
        toolName: params.toolName,
        callId: params.callId,
        createdAtMs: Date.now(),
        files: snapshots.map((snapshot) => ({
          path: snapshot.displayPath,
          existedBefore: snapshot.existedBefore,
        })),
      },
      snapshots,
    };
  }

  commit(record: CapturedFileCheckpoint): void {
    this.checkpoints.unshift(cloneRecord(record));
  }

  listCheckpoints(): GeneralAgentFileCheckpoint[] {
    return this.checkpoints.map((record) => cloneCheckpoint(record.checkpoint));
  }

  async restorePending(record: CapturedFileCheckpoint): Promise<void> {
    for (const snapshot of record.snapshots) {
      await restoreSnapshot(snapshot);
    }
  }

  async restoreCheckpoint(id: string): Promise<void> {
    const targetIndex = this.checkpoints.findIndex((record) => record.checkpoint.id === id);
    if (targetIndex === -1) {
      throw new Error(`Unknown checkpoint: ${id}`);
    }

    for (const record of this.checkpoints.slice(0, targetIndex + 1)) {
      await this.restorePending(record);
    }
    this.checkpoints.splice(0, targetIndex + 1);
  }
}

async function readExistingFile(
  absolutePath: string,
): Promise<{ existedBefore: boolean; contents: Buffer | null }> {
  try {
    const contents = await fs.readFile(absolutePath);
    return { existedBefore: true, contents };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { existedBefore: false, contents: null };
    }
    throw error;
  }
}

async function restoreSnapshot(snapshot: FileCheckpointSnapshot): Promise<void> {
  if (!snapshot.existedBefore) {
    await fs.rm(snapshot.absolutePath, { force: true });
    return;
  }

  await fs.mkdir(path.dirname(snapshot.absolutePath), { recursive: true });
  await fs.writeFile(snapshot.absolutePath, snapshot.contents ?? Buffer.alloc(0));
}

function dedupeTargets(files: FileCheckpointTarget[]): FileCheckpointTarget[] {
  const seen = new Set<string>();
  const deduped: FileCheckpointTarget[] = [];
  for (const file of files) {
    if (seen.has(file.absolutePath)) {
      continue;
    }
    seen.add(file.absolutePath);
    deduped.push(file);
  }
  return deduped;
}

function cloneRecord(record: FileCheckpointRecord): FileCheckpointRecord {
  return {
    checkpoint: cloneCheckpoint(record.checkpoint),
    snapshots: record.snapshots.map((snapshot) => ({
      absolutePath: snapshot.absolutePath,
      displayPath: snapshot.displayPath,
      existedBefore: snapshot.existedBefore,
      contents: snapshot.contents ? Buffer.from(snapshot.contents) : null,
    })),
  };
}

function cloneCheckpoint(checkpoint: GeneralAgentFileCheckpoint): GeneralAgentFileCheckpoint {
  return {
    ...checkpoint,
    files: checkpoint.files.map((file) => ({ ...file })),
  };
}
