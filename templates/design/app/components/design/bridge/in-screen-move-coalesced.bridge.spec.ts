import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedEditorChromeBridgeScript(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("live-screen"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

const FIXTURE = `<!doctype html><html><body style="margin:0">
  <div data-agent-native-node-id="box-a"
       style="position:absolute;left:30px;top:280px;width:120px;height:80px;background:#3b82f6"></div>
</body></html>`;

const TICKS = 300;

declare global {
  interface Window {
    __livePositions?: number;
    __selected?: boolean;
  }
}

describe("an in-screen layer move applies one tick per animation frame", () => {
  it("coalesces a burst of pointer ticks and still lands on the last one", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      await page.evaluate(() => {
        const probe = window;
        probe.__livePositions = 0;
        probe.__selected = false;
        window.addEventListener("message", (e: MessageEvent) => {
          if (e.data?.type === "element-select") probe.__selected = true;
          if (
            e.data?.type === "agent-native:live-drag-position" &&
            e.data.active === true
          ) {
            probe.__livePositions = (probe.__livePositions ?? 0) + 1;
          }
        });
      });
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="box-a"]',
          },
          "*",
        );
      });
      await page.waitForFunction(() => window.__selected);

      await page.mouse.move(90, 320);
      await page.mouse.down();
      await page.evaluate((ticks) => {
        window.__livePositions = 0;
        for (let i = 1; i <= ticks; i += 1) {
          const init = {
            bubbles: true,
            cancelable: true,
            clientX: 90 + i,
            clientY: 320,
            buttons: 1,
          };
          document.dispatchEvent(
            new PointerEvent("pointermove", { ...init, pointerId: 1 }),
          );
          document.dispatchEvent(new MouseEvent("mousemove", init));
        }
      }, TICKS);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      const postedAfterFrame = await page.evaluate(
        () => window.__livePositions,
      );

      expect(postedAfterFrame).toBeGreaterThan(0);
      expect(postedAfterFrame).toBeLessThanOrEqual(2);

      const left = await page
        .locator('[data-agent-native-node-id="box-a"]')
        .evaluate((el: HTMLElement) => Number.parseFloat(el.style.left));
      expect(left).toBeGreaterThanOrEqual(30 + TICKS - 10);
      await page.mouse.up();
    } finally {
      await browser.close();
    }
  });
});
