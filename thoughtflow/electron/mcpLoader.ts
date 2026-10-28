import * as path from 'path';
import type * as McpRuntime from './mcpRuntime';

let loaded: typeof McpRuntime | null = null;

/** MCP 부품을 처음 쓸 때 한 번 불러온다 (electron/mcpRuntime.ts) */
export function mcpRuntime(): typeof McpRuntime {
  // 경로를 식으로 주어 esbuild가 main.js에 함께 묶지 않게 한다
  loaded ??= require(path.join(__dirname, 'mcp-runtime.js')) as typeof McpRuntime;
  return loaded;
}
