Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

npm run typecheck
npm run compile
npm test