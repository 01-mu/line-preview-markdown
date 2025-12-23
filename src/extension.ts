import * as vscode from "vscode";

type RenderMode = "line" | "paragraph";
type ThemeMode = "auto" | "light" | "dark";

interface ExtensionConfig {
  enabled: boolean;
  maxPreviewLength: number;
  debounceMs: number;
  renderMode: RenderMode;
  theme: ThemeMode;
  excludeLanguages: string[];
}

const EXTENSION_NAMESPACE = "linePreviewMarkdown";

class PreviewController implements vscode.Disposable {
  private decorationType: vscode.TextEditorDecorationType;
  private statusBar: vscode.StatusBarItem;
  private config: ExtensionConfig;
  private renderTimer: NodeJS.Timeout | undefined;
  private disposables: vscode.Disposable[] = [];

  constructor(private context: vscode.ExtensionContext) {
    this.config = readConfig();
    this.decorationType = createDecorationType(this.config.theme);
    this.statusBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBar.command = `${EXTENSION_NAMESPACE}.toggle`;
    this.updateStatusBar();
    this.statusBar.show();

    this.disposables.push(
      this.statusBar,
      vscode.window.onDidChangeActiveTextEditor(() => this.scheduleRender()),
      vscode.window.onDidChangeTextEditorSelection(() =>
        this.scheduleRender()
      ),
      vscode.workspace.onDidChangeTextDocument((event) => {
        const editor = vscode.window.activeTextEditor;
        if (editor && event.document === editor.document) {
          this.scheduleRender();
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(EXTENSION_NAMESPACE)) {
          this.reloadConfig();
        }
      })
    );
  }

  dispose(): void {
    this.clearRenderTimer();
    this.decorationType.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  public refresh(): void {
    this.scheduleRender(true);
  }

  public toggleEnabled(): void {
    const newValue = !this.config.enabled;
    const target = vscode.workspace.workspaceFolders?.length
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;

    void vscode.workspace
      .getConfiguration(EXTENSION_NAMESPACE)
      .update("enabled", newValue, target);
  }

  private reloadConfig(): void {
    const nextConfig = readConfig();
    const themeChanged = nextConfig.theme !== this.config.theme;
    this.config = nextConfig;
    if (themeChanged) {
      this.decorationType.dispose();
      this.decorationType = createDecorationType(this.config.theme);
    }
    this.updateStatusBar();
    this.scheduleRender(true);
  }

  private updateStatusBar(): void {
    this.statusBar.text = this.config.enabled
      ? "MD Preview: On"
      : "MD Preview: Off";
    this.statusBar.tooltip = "Toggle inline markdown preview";
  }

  private scheduleRender(immediate = false): void {
    this.clearRenderTimer();
    if (immediate) {
      this.render();
      return;
    }

    const delay = Math.max(0, this.config.debounceMs);
    this.renderTimer = setTimeout(() => this.render(), delay);
  }

  private clearRenderTimer(): void {
    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
      this.renderTimer = undefined;
    }
  }

  private render(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    if (!this.config.enabled) {
      editor.setDecorations(this.decorationType, []);
      return;
    }

    if (
      editor.document.languageId !== "markdown" ||
      this.config.excludeLanguages.includes(editor.document.languageId)
    ) {
      editor.setDecorations(this.decorationType, []);
      return;
    }

    try {
      const previewText = buildPreviewText(
        editor,
        this.config.renderMode,
        this.config.maxPreviewLength
      );
      if (!previewText) {
        editor.setDecorations(this.decorationType, []);
        return;
      }

      const selectionLine = editor.selection.active.line;
      const line = editor.document.lineAt(selectionLine);
      const range = new vscode.Range(line.range.end, line.range.end);
      const decoration: vscode.DecorationOptions = {
        range,
        renderOptions: {
          after: {
            contentText: ` -> ${previewText}`
          }
        }
      };
      editor.setDecorations(this.decorationType, [decoration]);
    } catch {
      editor.setDecorations(this.decorationType, []);
    }
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const controller = new PreviewController(context);
  context.subscriptions.push(controller);

  context.subscriptions.push(
    vscode.commands.registerCommand(`${EXTENSION_NAMESPACE}.toggle`, () =>
      controller.toggleEnabled()
    ),
    vscode.commands.registerCommand(`${EXTENSION_NAMESPACE}.refresh`, () =>
      controller.refresh()
    )
  );

  controller.refresh();
}

export function deactivate(): void {
  return;
}

function readConfig(): ExtensionConfig {
  const config = vscode.workspace.getConfiguration(EXTENSION_NAMESPACE);
  return {
    enabled: config.get("enabled", true),
    maxPreviewLength: config.get("maxPreviewLength", 120),
    debounceMs: config.get("debounceMs", 150),
    renderMode: config.get("renderMode", "line"),
    theme: config.get("theme", "auto"),
    excludeLanguages: config.get("excludeLanguages", [])
  };
}

function createDecorationType(theme: ThemeMode): vscode.TextEditorDecorationType {
  const color =
    theme === "auto"
      ? new vscode.ThemeColor("descriptionForeground")
      : theme === "light"
        ? "#5a5a5a"
        : "#9a9a9a";

  return vscode.window.createTextEditorDecorationType({
    after: {
      margin: "0 0 0 1rem",
      color,
      fontStyle: "italic"
    }
  });
}

function buildPreviewText(
  editor: vscode.TextEditor,
  renderMode: RenderMode,
  maxPreviewLength: number
): string {
  const activeLine = editor.selection.active.line;
  const document = editor.document;

  if (renderMode === "paragraph") {
    const range = getParagraphRange(document, activeLine);
    const lines = [];
    for (let line = range.start; line <= range.end; line += 1) {
      lines.push(stripLineSyntax(document.lineAt(line).text));
    }
    const combined = lines.join(" ");
    return truncate(renderInlineMarkdown(combined), maxPreviewLength);
  }

  const lineText = document.lineAt(activeLine).text;
  const cleaned = stripLineSyntax(lineText);
  return truncate(renderInlineMarkdown(cleaned), maxPreviewLength);
}

function getParagraphRange(
  document: vscode.TextDocument,
  line: number
): { start: number; end: number } {
  let start = line;
  let end = line;

  while (start > 0 && !document.lineAt(start - 1).isEmptyOrWhitespace) {
    start -= 1;
  }

  while (
    end < document.lineCount - 1 &&
    !document.lineAt(end + 1).isEmptyOrWhitespace
  ) {
    end += 1;
  }

  return { start, end };
}

function stripLineSyntax(line: string): string {
  let text = line.trim();
  text = text.replace(/^#{1,6}\s+/, "");
  text = text.replace(/^>\s?/, "");
  text = text.replace(/^(\d+\.)\s+/, "");
  text = text.replace(/^[-*+]\s+/, "");
  return text;
}

function renderInlineMarkdown(text: string): string {
  let output = text;
  output = output.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");
  output = output.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  output = output.replace(/`([^`]+)`/g, "$1");
  output = output.replace(/\*\*([^*]+)\*\*/g, "$1");
  output = output.replace(/__([^_]+)__/g, "$1");
  output = output.replace(/\*([^*]+)\*/g, "$1");
  output = output.replace(/_([^_]+)_/g, "$1");
  output = output.replace(/~~([^~]+)~~/g, "$1");
  output = output.replace(/\s+/g, " ").trim();
  return output;
}

function truncate(text: string, maxLength: number): string {
  if (maxLength <= 0) {
    return "";
  }

  if (text.length <= maxLength) {
    return text;
  }

  if (maxLength <= 3) {
    return text.slice(0, maxLength);
  }

  return `${text.slice(0, maxLength - 3).trimEnd()}...`;
}
