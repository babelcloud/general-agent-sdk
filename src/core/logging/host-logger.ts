import fs from "node:fs";
import path from "node:path";
import type { GeneralAgentHostLogger, GeneralAgentLogEvent } from "../../public/types.js";

export class HostLoggerSink {
  constructor(
    private readonly logger: GeneralAgentHostLogger,
    private readonly rawEventLogPath?: string,
  ) {}

  emitInfo(event: GeneralAgentLogEvent): void {
    this.logger.onInfo(event);
  }

  emitDebug(event: GeneralAgentLogEvent): void {
    this.logger.onDebug(event);
  }

  emitWarn(event: GeneralAgentLogEvent): void {
    this.logger.onWarn(event);
  }

  emitError(event: GeneralAgentLogEvent): void {
    this.logger.onError(event);
  }

  emitRaw(event: Record<string, unknown>): void {
    this.logger.onRawStreamEvent?.(event);
    if (!this.rawEventLogPath) {
      return;
    }

    fs.mkdirSync(path.dirname(this.rawEventLogPath), { recursive: true });
    fs.appendFileSync(this.rawEventLogPath, JSON.stringify(event) + "\n", "utf-8");
  }
}
