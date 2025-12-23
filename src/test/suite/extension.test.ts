import * as assert from "assert";
import * as vscode from "vscode";

suite("Line Preview Markdown", () => {
  test("activates the extension", async () => {
    const extension = vscode.extensions.getExtension(
      "line-preview.line-preview-markdown"
    );
    assert.ok(extension, "Extension should be registered.");

    await extension?.activate();
    assert.ok(extension?.isActive, "Extension should activate.");
  });
});
