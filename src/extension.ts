import * as path from "path";
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
  private panelProvider: PreviewPanelProvider;

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

    this.panelProvider = new PreviewPanelProvider();
    this.context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        PreviewPanelProvider.viewType,
        this.panelProvider
      )
    );

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

  public async togglePanel(): Promise<void> {
    if (this.panelProvider.isVisible()) {
      await vscode.commands.executeCommand("workbench.action.closePanel");
      return;
    }

    await vscode.commands.executeCommand(
      "workbench.view.extension.linePreviewMarkdownPanel"
    );
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
    const panelContext = {
      enabled: this.config.enabled,
      theme: this.config.theme
    };

    if (!editor) {
      this.panelProvider.update("", panelContext);
      return;
    }

    if (!this.config.enabled) {
      editor.setDecorations(this.decorationType, []);
      this.panelProvider.update("", panelContext);
      return;
    }

    if (
      !isMarkdownDocument(editor.document) ||
      this.config.excludeLanguages.includes(editor.document.languageId)
    ) {
      editor.setDecorations(this.decorationType, []);
      this.panelProvider.update("", panelContext);
      return;
    }

    try {
      const previewSource = buildPreviewSource(
        editor,
        this.config.renderMode,
        this.config.maxPreviewLength
      );
      if (!previewSource) {
        editor.setDecorations(this.decorationType, []);
        this.panelProvider.update("", panelContext);
        return;
      }

      const previewText = renderInlineMarkdownToText(previewSource);
      const previewHtml = renderInlineMarkdownToHtml(previewSource);

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
      this.panelProvider.update(previewHtml, panelContext);
    } catch {
      editor.setDecorations(this.decorationType, []);
      this.panelProvider.update("", panelContext);
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
    ),
    vscode.commands.registerCommand(`${EXTENSION_NAMESPACE}.togglePanel`, () =>
      controller.togglePanel()
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

function isMarkdownDocument(document: vscode.TextDocument): boolean {
  if (document.languageId === "markdown") {
    return true;
  }

  const extension = path.extname(document.fileName).toLowerCase();
  return extension === ".md" || extension === ".markdown";
}

function buildPreviewSource(
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
    return truncate(combined, maxPreviewLength);
  }

  const lineText = document.lineAt(activeLine).text;
  const cleaned = stripLineSyntax(lineText);
  return truncate(cleaned, maxPreviewLength);
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

function renderInlineMarkdownToText(text: string): string {
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

function renderInlineMarkdownToHtml(text: string): string {
  let output = escapeHtml(text);
  output = output.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");
  output = output.replace(
    /\[([^\]]+)\]\([^)]+\)/g,
    '<span class="link">$1</span>'
  );
  output = output.replace(/`([^`]+)`/g, "<code>$1</code>");
  output = output.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  output = output.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  output = output.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  output = output.replace(/_([^_]+)_/g, "<em>$1</em>");
  output = output.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  output = output.replace(/\s+/g, " ").trim();
  return output;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

class PreviewPanelProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  public static readonly viewType = "linePreviewMarkdown.preview";

  private view: vscode.WebviewView | undefined;
  private visible = false;
  private lastContent = "";
  private lastContext: { enabled: boolean; theme: ThemeMode } = {
    enabled: true,
    theme: "auto"
  };

  public resolveWebviewView(
    webviewView: vscode.WebviewView
  ): void | Thenable<void> {
    this.view = webviewView;
    this.visible = webviewView.visible;
    webviewView.webview.options = {
      enableScripts: false,
      localResourceRoots: []
    };
    webviewView.webview.html = this.buildHtml(
      this.lastContent,
      this.lastContext
    );
    webviewView.onDidChangeVisibility(() => {
      this.visible = webviewView.visible;
    });
  }

  public dispose(): void {
    this.view = undefined;
  }

  public isVisible(): boolean {
    return this.visible;
  }

  public update(
    htmlContent: string,
    context: { enabled: boolean; theme: ThemeMode }
  ): void {
    this.lastContent = htmlContent;
    this.lastContext = context;
    if (!this.view) {
      return;
    }

    this.view.webview.html = this.buildHtml(htmlContent, context);
  }

  private buildHtml(
    htmlContent: string,
    context: { enabled: boolean; theme: ThemeMode }
  ): string {
    const themeClass =
      context.theme === "auto" ? "" : `theme-${context.theme}`;
    const content = context.enabled
      ? htmlContent || '<span class="muted">No preview</span>'
      : '<span class="muted">Preview disabled</span>';

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Line Preview</title>
    <style>
      :root {
        color-scheme: light dark;
      }
      body {
        margin: 0;
        padding: 12px 14px;
        font-family: var(--vscode-editor-font-family);
        font-size: 13px;
        color: var(--vscode-foreground);
        background: var(--vscode-editor-background);
      }
      .container {
        border: 1px solid var(--vscode-panel-border);
        border-radius: 8px;
        padding: 10px 12px;
        background: var(--vscode-editorWidget-background);
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
      }
      .muted {
        color: var(--vscode-descriptionForeground);
        font-style: italic;
      }
      code {
        padding: 0 4px;
        border-radius: 4px;
        background: var(--vscode-textCodeBlock-background);
        font-family: var(--vscode-editor-font-family);
      }
      .link {
        color: var(--vscode-textLink-foreground);
        text-decoration: underline;
      }
      del {
        color: var(--vscode-descriptionForeground);
      }
      .theme-light body {
        color: #1a1a1a;
        background: #ffffff;
      }
      .theme-dark body {
        color: #e6e6e6;
        background: #1f1f1f;
      }
    </style>
  </head>
  <body class="${themeClass}">
    <div class="container">${content}</div>
  </body>
</html>`;
  }
}
