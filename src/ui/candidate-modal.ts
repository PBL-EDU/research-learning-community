import { Modal, Notice, Setting } from "obsidian";
import type RlcPlugin from "../main";
import { checkDoi, type DoiVerdict } from "../core/crossref";
import type { ReviewCandidate } from "../core/review";

type RowStatus = "unchecked" | "checking" | DoiVerdict | "no-doi";

interface Row {
  candidate: ReviewCandidate;
  status: RowStatus;
  selected: boolean;
  remoteTitle?: string;
}

const VERDICT_TEXT: Record<RowStatus, string> = {
  unchecked: "未核验",
  checking: "核验中…",
  verified: "✓ Crossref 已核验",
  "title-mismatch": "⚠️ DOI 存在但标题不符",
  "not-found": "✗ Crossref 查不到这个 DOI",
  "network-error": "网络错误，稍后重试",
  "no-doi": "无 DOI，无法核验",
};

/**
 * 候选文献勾选与核验。
 *
 * 设计原则：AI 提议的文献默认全部勾选，但每一条都要能被 Crossref 证伪。
 * 未核验的可以加，但必须显式打开开关——让「我知道我在冒险」成为一个动作。
 */
export class CandidateModal extends Modal {
  private readonly rows: Row[];
  private busy = false;
  private allowRisky = false;

  constructor(
    app: Modal["app"],
    private readonly rlc: RlcPlugin,
    private readonly domain: string,
    candidates: ReviewCandidate[],
    private readonly onDone?: () => void,
  ) {
    super(app);
    this.rows = candidates.map((candidate) => ({
      candidate,
      status: candidate.doi ? "unchecked" : "no-doi",
      selected: true,
    }));
  }

  override onOpen(): void {
    this.modalEl.addClass("rlc-modal");
    this.render();
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  private selectedCount(): number {
    return this.rows.filter((row) => row.selected).length;
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "选择文献加入领域" });
    contentEl.createEl("p", {
      text: `领域：${this.domain}。勾选后会为每篇文献建立「文献/<citekey>/文献信息.md」；PDF 下载留到下一步。`,
      cls: "rlc-hint",
    });

    const list = contentEl.createDiv({ cls: "rlc-cands" });
    this.rows.forEach((row) => {
      const item = list.createDiv({ cls: "rlc-cand" });

      const checkbox = item.createEl("input", { type: "checkbox" });
      checkbox.checked = row.selected;
      checkbox.addEventListener("change", () => {
        row.selected = checkbox.checked;
      });

      const main = item.createDiv({ cls: "rlc-cand-main" });
      const title = main.createDiv({ cls: "rlc-cand-title" });
      title.createSpan({ text: row.candidate.title });

      const meta = [
        row.candidate.year ? String(row.candidate.year) : "",
        row.candidate.authors.join("、"),
        row.candidate.venue ?? "",
      ]
        .filter(Boolean)
        .join(" · ");
      if (meta.length > 0) title.createSpan({ text: `  ${meta}`, cls: "rlc-muted" });

      if (row.candidate.doi) {
        main.createDiv({ text: `DOI: ${row.candidate.doi}`, cls: "rlc-muted rlc-cand-doi" });
      }
      if (row.candidate.why) {
        main.createDiv({ text: row.candidate.why, cls: "rlc-muted" });
      }

      const status = main.createDiv({ cls: `rlc-cand-status rlc-verdict-${row.status}` });
      const suffix =
        row.status === "verified" || row.status === "title-mismatch"
          ? `：${row.remoteTitle ?? ""}`
          : "";
      status.setText(`${VERDICT_TEXT[row.status]}${suffix}`);
    });

    const toggle = new Setting(contentEl)
      .setName("允许加入未通过核验的文献")
      .setDesc("默认关闭。打开后，标红或标题不符的条目也能写入领域。")
      .addToggle((component) =>
        component.setValue(this.allowRisky).onChange((value) => {
          this.allowRisky = value;
        }),
      );

    toggle.settingEl.addClass("rlc-risky-toggle");

    new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText("核验全部 DOI").onClick(async () => {
          await this.verifyAll(button.buttonEl);
        }),
      )
      .addButton((button) =>
        button.setButtonText(`加入领域（${this.selectedCount()}）`).setCta().onClick(async () => {
          await this.addSelected(button.buttonEl);
        }),
      );
  }

  private async verifyAll(buttonEl: HTMLButtonElement): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    buttonEl.disabled = true;

    try {
      for (const row of this.rows) {
        if (!row.candidate.doi) {
          row.status = "no-doi";
          continue;
        }
        row.status = "checking";
        this.render();
        const result = await checkDoi(row.candidate.doi, row.candidate.title);
        row.status = result.verdict;
        row.remoteTitle = result.remoteTitle;
        this.render();
      }
      new Notice("核验完成");
    } finally {
      this.busy = false;
      buttonEl.disabled = false;
      this.render();
    }
  }

  private async addSelected(buttonEl: HTMLButtonElement): Promise<void> {
    if (this.busy) return;

    const selected = this.rows.filter((row) => row.selected);
    if (selected.length === 0) {
      new Notice("先勾选至少一篇");
      return;
    }

    const risky = selected.filter(
      (row) => row.status === "not-found" || row.status === "title-mismatch",
    );
    if (risky.length > 0 && !this.allowRisky) {
      new Notice(
        `有 ${risky.length} 篇未通过核验。先点「核验全部 DOI」，或打开「允许加入未通过核验的文献」。`,
      );
      return;
    }

    this.busy = true;
    buttonEl.disabled = true;
    let created = 0;
    let existed = 0;
    let failed = 0;

    try {
      for (const row of selected) {
        const result = await this.rlc.literatures.create({
          domain: this.domain,
          title: row.candidate.title,
          authors: row.candidate.authors,
          year: row.candidate.year,
          doi: row.candidate.doi,
        });
        if (result.ok) {
          created += 1;
          void this.rlc.translateTitleFor(result.path, row.candidate.title);
        }
        else if (result.code === "EXISTS") existed += 1;
        else failed += 1;
      }

      this.close();
      const parts = [`已加入 ${created} 篇`];
      if (existed > 0) parts.push(`${existed} 篇已存在`);
      if (failed > 0) parts.push(`${failed} 篇失败`);
      new Notice(parts.join("，"));
      this.onDone?.();
    } catch (error) {
      new Notice(`加入失败：${(error as Error).message}`);
    } finally {
      this.busy = false;
      buttonEl.disabled = false;
    }
  }
}
