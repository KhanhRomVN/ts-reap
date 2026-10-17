import type { ProgressEvent } from "../core/types";
import { fit, gradientAt, terminalWidth, type Painter } from "./ansi";
import { STAGE_LABEL } from "./theme";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const BAR_WIDTH = 24;
const MIN_FRAME_MS = 40;

/**
 * Thanh tiến trình 1 dòng (spinner + bar gradient + %). Chỉ vẽ khi stream là TTY.
 * Phân tích là đồng bộ nên không dùng timer: mỗi sự kiện progress vẽ lại 1 frame (có throttle).
 */
export class LoadingProgress {
  private frame = 0;
  private lastDraw = 0;
  private active = false;
  private readonly exitHandler = () => this.restoreCursor();

  constructor(
    private readonly out: NodeJS.WriteStream,
    private readonly paint: Painter,
  ) {}

  private get interactive(): boolean {
    return Boolean(this.out.isTTY);
  }

  start(message: string): void {
    if (!this.interactive) return;
    this.active = true;
    this.out.write("\x1b[?25l"); // ẩn con trỏ
    process.once("exit", this.exitHandler);
    this.drawRaw(`${this.paint.cyan(SPINNER[0])} ${this.paint.dim(message)}`);
  }

  update(e: ProgressEvent): void {
    if (!this.active) return;
    const now = Date.now();
    const done = e.current >= e.total;
    if (!done && now - this.lastDraw < MIN_FRAME_MS) return;
    this.lastDraw = now;
    this.frame = (this.frame + 1) % SPINNER.length;

    const stageFraction = e.total > 0 ? e.current / e.total : 0;
    const overall = Math.min(1, (e.stageIndex + stageFraction) / e.stageCount);
    const pct = String(Math.round(overall * 100)).padStart(3);

    const step = this.paint.gray(`[${e.stageIndex + 1}/${e.stageCount}]`);
    const label = STAGE_LABEL[e.stage].padEnd(22);
    const head = `${this.paint.cyan(SPINNER[this.frame])} ${step} ${label} ${this.renderBar(overall)} ${pct}%`;

    // Phần còn lại của dòng dành cho tên file đang xử lý.
    const used = 2 + 5 + 1 + 22 + 1 + BAR_WIDTH + 1 + 4 + 2;
    const room = terminalWidth(this.out) - used - 1;
    const file = e.file && room > 8 ? this.paint.dim(fit(e.file, room)) : "";

    this.drawRaw(`${head}  ${file}`);
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.out.write("\r\x1b[2K");
    this.restoreCursor();
    process.removeListener("exit", this.exitHandler);
  }

  private renderBar(fraction: number): string {
    const filled = Math.round(fraction * BAR_WIDTH);
    let bar = "";
    for (let i = 0; i < BAR_WIDTH; i++) {
      bar +=
        i < filled
          ? this.paint.color(gradientAt(i / BAR_WIDTH), "━")
          : this.paint.dim("─");
    }
    return bar;
  }

  private drawRaw(line: string): void {
    this.out.write(`\r\x1b[2K  ${line}`);
  }

  private restoreCursor(): void {
    this.out.write("\x1b[?25h");
  }
}
