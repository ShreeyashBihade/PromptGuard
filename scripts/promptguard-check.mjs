import { execSync } from "node:child_process";

const commands = ["npm run typecheck", "npm run compile", "npm test"];

for (const command of commands) {
  execSync(command, { stdio: "inherit", shell: true });
}