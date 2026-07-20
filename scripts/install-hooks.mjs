import { execSync } from "node:child_process";

execSync("git config core.hooksPath .githooks", { stdio: "inherit", shell: true });