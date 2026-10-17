# Study Trade VCP

Manual-signal Indian-equities application, implementing ST_VCP_4_0 from KAN-4 through KAN-139. No brokerage order execution.

## Status

Foundation, authentication, independent UI shell, indicators, strategy configuration and VCP domain rules are implemented and locally verified. Scanner persistence and APIs are under development. This is not yet a usable trading application. Full imported requirements are in docs/jira-requirements.json, with evidence and remaining scope in docs/implementation-status.md. UI design is independent, as requested; Figma is not a dependency.

## Development

Node 24 and pnpm 11.25.0. Run `pnpm install`, `pnpm build`, `pnpm typecheck`, `pnpm test`, and `pnpm lint`.

Apps: Next.js web, NestJS API, independent BullMQ worker. Shared domain rules belong in packages, never copied into apps. Provider access belongs only in market-data. Financial JSON values are decimal strings, timestamps UTC, sessions Asia/Kolkata.
