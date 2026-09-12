import http from "node:http";
import { createHandler } from "./app.js";

const port = Number(process.env.PORT ?? 8787);
const server = http.createServer(createHandler());

server.listen(port, "0.0.0.0", () => {
  console.log(`Study Shield API listening on http://0.0.0.0:${port}`);
});

function shutdown(signal) {
  console.log(`${signal} received; shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
