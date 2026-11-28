import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

const CHILD_COUNT = 2000;

function bridgeScript(ownership: string): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("boot-test"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace("__LIVE_REFLOW_ENABLED__", "false")
    .replace("__SELECTED_LAYER_DRAG_PRIORITY__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, () => JSON.stringify(""))
    .replace(/__INITIAL_SOURCE_OWNERSHIP__/g, () => JSON.stringify(ownership));
}

describe("bridge source-ownership boot on a flat dense screen", () => {
  it("reads a shared parent's children a bounded number of times", async () => {
    const ids = Array.from({ length: CHILD_COUNT }, (_, i) => `n${i}`);
    const body = ids
      .map((id) => `<div data-agent-native-node-id="${id}">x</div>`)
      .join("");
    const ownership = JSON.stringify({
      body: { attrs: [], className: "", style: "" },
      sourceNodeIds: ids,
      nodes: ids.map((nodeId) => ({
        nodeId,
        tagName: "div",
        meta: { attrs: [], className: "", style: "" },
      })),
    });
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setContent(
        `<!doctype html><html><head></head><body><main id="flat">${body}</main></body></html>`,
      );
      await page.evaluate(() => {
        const descriptor = Object.getOwnPropertyDescriptor(
          Element.prototype,
          "children",
        );
        if (!descriptor?.get) throw new Error("children getter missing");
        const read = descriptor.get;
        const counter = { reads: 0 };
        (
          window as unknown as { __childrenReads: typeof counter }
        ).__childrenReads = counter;
        Object.defineProperty(Element.prototype, "children", {
          configurable: true,
          get() {
            if ((this as Element).id === "flat") counter.reads += 1;
            return read.call(this);
          },
        });
      });
      await page.addScriptTag({ content: bridgeScript(ownership) });
      await page.waitForFunction(
        (lastId) =>
          !!(
            document.querySelector(
              `[data-agent-native-node-id="${lastId}"]`,
            ) as (Element & { __anSourceMeta?: unknown }) | null
          )?.__anSourceMeta,
        ids[ids.length - 1],
      );
      const reads = await page.evaluate(
        () =>
          (window as unknown as { __childrenReads: { reads: number } })
            .__childrenReads.reads,
      );
      expect(errors).toEqual([]);
      expect(reads).toBeLessThan(CHILD_COUNT / 10);
    } finally {
      await browser.close();
    }
  }, 60_000);
});
