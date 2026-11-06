import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildServer } from "@/lib/mcp";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // convene_court may take a while

// Stateless MCP over Streamable HTTP: a fresh server per request, JSON responses.
export async function POST(req: Request) {
  const server = buildServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}

const notSupported = () =>
  new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Use POST (stateless MCP server)." }, id: null }), {
    status: 405,
    headers: { "Content-Type": "application/json", Allow: "POST" },
  });
export const GET = notSupported;
export const DELETE = notSupported;
