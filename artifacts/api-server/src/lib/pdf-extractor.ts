import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export async function extractTextOnly(filePath: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "pdftotext",
    ["-layout", filePath, "-"],
    { maxBuffer: 10 * 1024 * 1024 },
  );
  return stdout.trim();
}
