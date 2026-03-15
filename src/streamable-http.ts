// src/streamable-http.ts
import http, { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: any;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: any;
  error?: { code: number; message: string; data?: any };
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// 简单 Origin 校验：允许空 Origin（CLI/Server-to-server 常见），
// 如需限制浏览器来源，用 MCP_ORIGIN_ALLOWLIST=comma,separated,origins
function isOriginAllowed(origin: string | undefined, allowlist: string[]) {
  if (!origin) return true;
  if (allowlist.length === 0) return false;
  return allowlist.includes(origin);
}

export async function startStreamableHttpServer(opts: {
  host: string;                 // 建议 127.0.0.1（规范建议本地绑定）[1](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports)[2](https://llmstock.com/post/241)
  port: number;
  path?: string;                // 默认 /mcp
  serverName: string;
  serverVersion: string;
  protocolVersion: string;      // 例如 2025-03-26 或 2025-06-18
  listTools: () => Promise<any[]>;
  callTool: (name: string, args: any) => Promise<any>;
}) {
  const mcpPath = opts.path ?? "/mcp";
  const allowlist = (process.env.MCP_ORIGIN_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      // 只处理 /mcp
      if (url.pathname !== mcpPath) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }

      // Origin 校验（规范要求防 DNS rebinding）[1](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports)[2](https://llmstock.com/post/241)
      const origin = req.headers["origin"] as string | undefined;
      if (!isOriginAllowed(origin, allowlist)) {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "origin not allowed" }));
        return;
      }

      if (req.method === "GET") {
        // Streamable HTTP 允许 GET；这里返回一个简单状态即可（MVP）
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok", endpoint: mcpPath }));
        return;
      }

      if (req.method !== "POST") {
        res.writeHead(405, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "method not allowed" }));
        return;
      }

      const body = await readBody(req);
      let msg: JsonRpcRequest;
      try {
        msg = JSON.parse(body);
      } catch {
        const resp: JsonRpcResponse = {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        };
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify(resp));
        return;
      }

      // JSON-RPC 基础校验
      if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
        const resp: JsonRpcResponse = {
          jsonrpc: "2.0",
          id: msg?.id ?? null,
          error: { code: -32600, message: "Invalid Request" },
        };
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify(resp));
        return;
      }

      const id = msg.id ?? null;

      // 处理 MCP 关键方法：initialize / ping / tools/list / tools/call
      // tools/list 和 tools/call 的 method 名称与结构是 MCP 官方定义。[3](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)[4](https://modelcontextprotocol.io/specification/2025-03-26/server/tools)
      let result: any;

      if (msg.method === "initialize") {
        result = {
          protocolVersion: opts.protocolVersion,
          capabilities: {
            tools: { listChanged: false },
          },
          serverInfo: { name: opts.serverName, version: opts.serverVersion },
        };
      } else if (msg.method === "ping") {
        result = { status: "ok" };
      } else if (msg.method === "tools/list") {
        const tools = await opts.listTools();
        result = { tools };
      } else if (msg.method === "tools/call") {
        const toolName = msg.params?.name;
        const toolArgs = msg.params?.arguments ?? {};
        if (!toolName || typeof toolName !== "string") {
          const resp: JsonRpcResponse = {
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: "Invalid params: missing tool name" },
          };
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify(resp));
          return;
        }
        result = await opts.callTool(toolName, toolArgs);
      } else {
        const resp: JsonRpcResponse = {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: "Method not found" },
        };
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify(resp));
        return;
      }

      // 通知（没有 id）不应返回响应；这里简单处理：无 id 则 204
      if (msg.id === undefined) {
        res.writeHead(204);
        res.end();
        return;
      }

      const resp: JsonRpcResponse = { jsonrpc: "2.0", id, result };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(resp));
    } catch (e: any) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "internal", detail: String(e?.message ?? e) }));
    }
  });

  await new Promise<void>((resolve) => server.listen(opts.port, opts.host, resolve));
  return server;
}
