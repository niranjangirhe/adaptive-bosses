import { createApp } from "./server.ts";

const port = Number(process.env.PORT ?? 4330);
createApp(process.cwd()).listen(port, "127.0.0.1", () => {
  console.log(`The boss is waiting on http://localhost:${port}`);
});
