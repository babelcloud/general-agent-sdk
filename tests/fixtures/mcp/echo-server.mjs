#!/usr/bin/env node

const stdin = process.stdin;
const stdout = process.stdout;

stdin.setEncoding("utf8");

let buffer = "";

stdin.on("data", (chunk) => {
  buffer += chunk;
  drainMessages();
});

function drainMessages() {
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      return;
    }

    const header = buffer.slice(0, headerEnd);
    const lengthMatch = /Content-Length:\s*(\d+)/i.exec(header);
    if (!lengthMatch) {
      throw new Error("Missing Content-Length header");
    }

    const bodyLength = Number(lengthMatch[1]);
    const messageStart = headerEnd + 4;
    const messageEnd = messageStart + bodyLength;
    if (buffer.length < messageEnd) {
      return;
    }

    const body = buffer.slice(messageStart, messageEnd);
    buffer = buffer.slice(messageEnd);
    handleMessage(JSON.parse(body));
  }
}

function sendMessage(message) {
  const body = JSON.stringify(message);
  stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}

function sendResult(id, result) {
  sendMessage({
    jsonrpc: "2.0",
    id,
    result,
  });
}

function handleMessage(message) {
  if (message.method === "initialize") {
    sendResult(message.id, {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: "echo-test-server",
        version: "0.0.1",
      },
    });
    return;
  }

  if (message.method === "notifications/initialized") {
    return;
  }

  if (message.method === "tools/list") {
    sendResult(message.id, {
      tools: [
        {
          name: "echo",
          description: "Echoes the provided text.",
          inputSchema: {
            type: "object",
            properties: {
              text: {
                type: "string",
              },
            },
            required: ["text"],
            additionalProperties: false,
          },
        },
      ],
    });
    return;
  }

  if (message.method === "tools/call") {
    const text = message.params?.arguments?.text ?? "";
    sendResult(message.id, {
      content: [
        {
          type: "text",
          text: `Echo: ${text}`,
        },
      ],
      structuredContent: {
        echoedText: text,
      },
      isError: false,
    });
  }
}
