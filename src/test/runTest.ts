import * as path from "path";
import {
  downloadAndUnzipVSCode,
  resolveCliPathFromVSCodeExecutablePath,
  runTests
} from "@vscode/test-electron";

async function main(): Promise<void> {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, "../../");
    const extensionTestsPath = path.resolve(__dirname, "./suite/index");

    const vscodeExecutablePath = await downloadAndUnzipVSCode("1.93.0");
    // macOS の Electron 直叩きだと --no-sandbox などが bad option で落ちるため、CLI ラッパーを使う。
    const vscodeCliPath =
      resolveCliPathFromVSCodeExecutablePath(vscodeExecutablePath);

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      vscodeExecutablePath: vscodeCliPath
    });
  } catch (error) {
    console.error("Failed to run VS Code tests.", error);
    process.exit(1);
  }
}

void main();
