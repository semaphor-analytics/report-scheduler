export function renderDevShellHelp(): string {
  return [
    "Commands:",
    "  /help                         Show this help",
    "  /context                      Call semaphor_get_analysis_context",
    "  /domains                      List semantic domains",
    "  /datasets <domainId>          List datasets and remember the domain",
    "  /schema <dataset> [domainId]  Inspect schema by dataset name, id, or label",
    "  /connections                  List accessible physical connections",
    "  /sql <connectionId> <sql>      Run a read-only SQL smoke query",
    "  /tools                        List MCP tools and schemas",
    "  /tool <name> <jsonArgs>        Call an arbitrary MCP tool",
    "  /last                         Show last MCP or run result",
    "  /evidence                     Show last run evidence",
    "  /artifact                     Show last run artifact",
    "  /save [artifact.md|runs]      Run and save artifact/evidence/trace",
    "  /reload                       Reload the Markdown definition",
    "  /reset                        Clear remembered state",
    "  /exit                         Exit",
    "",
    "Tip: run /datasets <domainId> before /schema so the shell can resolve dataset ids and names.",
  ].join("\n");
}
