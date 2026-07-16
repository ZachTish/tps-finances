import { createServer, type IncomingMessage, type ServerResponse } from "http";
import type { AddressInfo } from "net";
import type { PlaidLinkResult } from "./types";

const LINK_TIMEOUT_MS = 15 * 60 * 1000;

export async function openLocalPlaidLink(linkToken: string): Promise<PlaidLinkResult> {
  const callbackKey = randomKey();
  return new Promise<PlaidLinkResult>((resolve, reject) => {
    let settled = false;
    const finish = (result?: PlaidLinkResult, error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      server.close();
      if (error) reject(error);
      else if (result) resolve(result);
      else reject(new Error("Plaid Link ended without a result."));
    };

    const server = createServer((request, response) => {
      void handleRequest(request, response, linkToken, callbackKey, finish);
    });
    const timeout = window.setTimeout(() => finish(undefined, new Error("Plaid Link timed out.")), LINK_TIMEOUT_MS);

    server.once("error", (error) => finish(undefined, error));
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      const url = `http://127.0.0.1:${address.port}/`;
      const electron = require("electron") as { shell?: { openExternal?: (target: string) => Promise<void> } };
      const open = electron.shell?.openExternal?.(url);
      if (!open) window.open(url, "_blank", "noopener,noreferrer");
      else void open.catch((error) => finish(undefined, error));
    });
  });
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  linkToken: string,
  callbackKey: string,
  finish: (result?: PlaidLinkResult, error?: Error) => void,
): Promise<void> {
  if (request.method === "GET" && request.url === "/") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end(linkPage(linkToken, callbackKey));
    return;
  }

  if (request.method === "POST" && request.url === `/complete/${callbackKey}`) {
    try {
      const payload = JSON.parse(await readBody(request)) as Record<string, unknown>;
      const publicToken = String(payload.publicToken || "");
      if (!publicToken) throw new Error("Plaid Link did not return a public token.");
      response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Account connected. You can close this tab and return to Obsidian.");
      finish({ publicToken, institutionName: String(payload.institutionName || "Financial institution") });
    } catch (error) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("TPS Finances could not read the Plaid result.");
      finish(undefined, error instanceof Error ? error : new Error(String(error)));
    }
    return;
  }

  if (request.method === "POST" && request.url === `/exit/${callbackKey}`) {
    response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Plaid Link closed. You can return to Obsidian.");
    finish(undefined, new Error("Plaid Link was closed before an account was connected."));
    return;
  }

  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Not found");
}

function linkPage(linkToken: string, callbackKey: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect TPS Finances</title>
<style>body{margin:0;background:#111827;color:#f9fafb;font:16px system-ui;display:grid;place-items:center;min-height:100vh}.card{max-width:480px;padding:32px;border:1px solid #374151;border-radius:18px;background:#1f2937;text-align:center}button{border:0;border-radius:10px;padding:12px 18px;background:#4c76ae;color:white;font:inherit;font-weight:700;cursor:pointer}p{color:#d1d5db;line-height:1.5}</style>
<script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script></head>
<body><main class="card"><h1>TPS Finances</h1><p>Connect this Mac directly to Plaid. Credentials and access tokens remain in local Obsidian SecretStorage and are not written to your vault notes.</p><button id="connect" disabled>Loading Plaid…</button><p id="status"></p></main>
<script>
const token=${JSON.stringify(linkToken)};
const complete=${JSON.stringify(`/complete/${callbackKey}`)};
const exit=${JSON.stringify(`/exit/${callbackKey}`)};
const button=document.getElementById('connect');
const status=document.getElementById('status');
let completing=false;
const handler=Plaid.create({token,
 onLoad(){button.disabled=false;button.textContent='Connect an account';},
 async onSuccess(publicToken,metadata){
  if(completing)return;
  completing=true;
  button.disabled=true;
  status.textContent='Saving connection…';
  try{
   const response=await fetch(complete,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({publicToken,institutionName:metadata?.institution?.name||''})});
   if(!response.ok)throw new Error('TPS Finances could not save the Plaid connection.');
   status.textContent=await response.text();
  }catch(error){
   completing=false;
   button.disabled=false;
   status.textContent=error instanceof Error?error.message:'TPS Finances could not save the Plaid connection.';
  }
 },
 onExit(err){
  if(completing)return;
  completing=true;
  if(err)status.textContent=err.display_message||err.error_message||'Plaid Link closed';
  void fetch(exit,{method:'POST'}).catch(()=>undefined);
 }
});
button.addEventListener('click',()=>handler.open());
</script></body></html>`;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 64 * 1024) {
        reject(new Error("Plaid callback payload was too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function randomKey(): string {
  return (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`).replace(/[^a-z0-9]/gi, "");
}
