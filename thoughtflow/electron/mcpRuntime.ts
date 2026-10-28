/**
 * MCP 부품 (zod·ajv·MCP SDK — 약 1.4MB). 따로 빌드해(dist-electron/mcp-runtime.js) 처음 쓸 때 불러온다.
 * ChatGPT·Claude 웹 주소로 요청이 오거나 "연결 점검"을 할 때만 필요하므로, 프로그램 시작을 늦추지 않게 한다.
 */
export { Client } from '@modelcontextprotocol/sdk/client/index.js';
export { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
export { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
export { createMcpServer } from '../mcp/server';
