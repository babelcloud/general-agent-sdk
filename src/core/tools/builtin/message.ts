import type { BuiltinTool, BuiltinToolContext, BuiltinToolResult } from "./types.js";

/**
 * Message tool — send messages and perform channel actions.
 *
 * In the SDK, this tool delegates to a configurable message handler
 * or gateway. Set MESSAGE_GATEWAY_URL env var to point to the message service.
 */
export const messageTool: BuiltinTool = {
  definition: {
    name: "message",
    description:
      "Send messages and perform channel actions across configured messaging channels " +
      "(Telegram, Discord, Slack, etc.). Requires MESSAGE_GATEWAY_URL.",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description:
            "Message action: send, delete, react, pin, unpin, fetch, typing, poll, etc.",
        },
        channel: {
          type: "string",
          description: "Channel identifier (e.g., 'telegram', 'discord', 'slack').",
        },
        target: {
          type: "string",
          description: "Target user or channel.",
        },
        message: {
          type: "string",
          description: "Message text to send.",
        },
        media: {
          type: "string",
          description: "Media URL or local path for attachment.",
        },
        filename: {
          type: "string",
          description: "Filename for attachment.",
        },
        caption: {
          type: "string",
          description: "Caption for media attachment.",
        },
        replyTo: {
          type: "string",
          description: "Message ID to reply to.",
        },
        threadId: {
          type: "string",
          description: "Thread ID for threaded messages.",
        },
        messageId: {
          type: "string",
          description: "Target message ID (for reactions, delete, etc.).",
        },
        emoji: {
          type: "string",
          description: "Emoji for reaction.",
        },
        silent: {
          type: "boolean",
          description: "Send without notification.",
        },
        asVoice: {
          type: "boolean",
          description: "Send audio as voice message.",
        },
        forceDocument: {
          type: "boolean",
          description: "Send as document (avoid compression).",
        },
        asDocument: {
          type: "boolean",
          description: "Send as document (alias for forceDocument).",
        },
        interactive: {
          type: "object",
          description: "Interactive message payload with buttons/selects.",
        },
        dryRun: {
          type: "boolean",
          description: "Simulate without actually sending.",
        },
        targets: {
          type: "array",
          items: { type: "string" },
          description: "Multiple targets for broadcast.",
        },
        accountId: {
          type: "string",
          description: "Account ID for multi-account channels.",
        },
        effectId: {
          type: "string",
          description: "Message effect ID.",
        },
        effect: {
          type: "string",
          description: "Message effect name.",
        },
        buffer: {
          type: "string",
          description: "Base64 encoded buffer for attachment.",
        },
        contentType: {
          type: "string",
          description: "MIME content type for buffer.",
        },
        mimeType: {
          type: "string",
          description: "MIME type for attachment.",
        },
        path: {
          type: "string",
          description: "Local file path for attachment.",
        },
        filePath: {
          type: "string",
          description: "Local file path for attachment (alias).",
        },
        quoteText: {
          type: "string",
          description: "Quoted text for reply.",
        },
        bestEffort: {
          type: "boolean",
          description: "Best-effort delivery.",
        },
        gifPlayback: {
          type: "boolean",
          description: "Enable GIF playback.",
        },
        message_id: {
          type: "string",
          description: "Message ID (snake_case alias).",
        },
        remove: {
          type: "boolean",
          description: "Remove reaction.",
        },
        channelId: {
          type: "string",
          description: "Channel-specific target ID.",
        },
        channelIds: {
          type: "array",
          items: { type: "string" },
          description: "Multiple channel IDs.",
        },
        chatId: {
          type: "string",
          description: "Chat-specific target ID.",
        },
        guildId: {
          type: "string",
          description: "Discord guild ID.",
        },
        userId: {
          type: "string",
          description: "User ID.",
        },
        memberId: {
          type: "string",
          description: "Member ID.",
        },
        memberIdType: {
          type: "string",
          description: "Member ID type.",
        },
        limit: {
          type: "number",
          description: "Result limit for fetch actions.",
        },
        pageSize: {
          type: "number",
          description: "Page size for pagination.",
        },
        pageToken: {
          type: "string",
          description: "Page token for pagination.",
        },
        before: {
          type: "string",
          description: "Fetch messages before this ID.",
        },
        after: {
          type: "string",
          description: "Fetch messages after this ID.",
        },
        around: {
          type: "string",
          description: "Fetch messages around this ID.",
        },
        fromMe: {
          type: "boolean",
          description: "Filter own messages.",
        },
        includeArchived: {
          type: "boolean",
          description: "Include archived messages.",
        },
        query: {
          type: "string",
          description: "Search query.",
        },
        threadName: {
          type: "string",
          description: "Thread name for thread creation.",
        },
        name: {
          type: "string",
          description: "Name for channel/resource creation.",
        },
        type: {
          type: "string",
          description: "Type for channel/resource creation.",
        },
        reason: {
          type: "string",
          description: "Reason for moderation actions.",
        },
        deleteDays: {
          type: "number",
          description: "Days of messages to delete (moderation).",
        },
        gatewayUrl: {
          type: "string",
          description: "Override message gateway URL.",
        },
        gatewayToken: {
          type: "string",
          description: "Gateway auth token.",
        },
        timeoutMs: {
          type: "number",
          description: "Request timeout in milliseconds.",
        },
      },
      required: ["action"],
    },
  },

  async execute(input: Record<string, unknown>, ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
    const action = input.action as string;
    const env = ctx.env ?? process.env;
    const gatewayUrl = (input.gatewayUrl as string) || env.MESSAGE_GATEWAY_URL;

    if (!gatewayUrl) {
      return {
        content: JSON.stringify({
          error: "not_configured",
          message:
            "Message gateway is not configured. Set MESSAGE_GATEWAY_URL environment variable " +
            "or pass gatewayUrl parameter.",
          action,
        }),
        isError: true,
      };
    }

    const timeoutMs = typeof input.timeoutMs === "number" ? input.timeoutMs : 30_000;
    const token = (input.gatewayToken as string) || env.MESSAGE_GATEWAY_TOKEN;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      const body: Record<string, unknown> = { ...input };
      delete body.gatewayUrl;
      delete body.gatewayToken;

      const resp = await fetch(`${gatewayUrl}/message`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!resp.ok) {
        return {
          content: JSON.stringify({
            error: "gateway_error",
            status: resp.status,
            message: await resp.text(),
          }),
          isError: true,
        };
      }

      const result = await resp.json();
      return { content: JSON.stringify(result) };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: JSON.stringify({ error: "message_error", message: msg, action }), isError: true };
    }
  },
};
