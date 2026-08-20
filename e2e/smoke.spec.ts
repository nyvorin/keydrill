import { expect, test, type Page } from "@playwright/test";

/** Collect console errors + uncaught page errors so every spec can assert a clean console. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

/** Leaf <span>s inside the typing pane are the per-character target cells, in order. */
async function targetCells(page: Page): Promise<string[]> {
  return page.$$eval('[data-testid="typing-pane"] span', (spans) =>
    spans
      .filter((s) => s.childElementCount === 0)
      .map((s) => s.textContent ?? "")
      .filter((t) => t.length > 0),
  );
}

/** The class attribute of the nth target cell ('' when the cell does not exist). */
async function cellClass(page: Page, index: number): Promise<string> {
  return page.$$eval(
    '[data-testid="typing-pane"] span',
    (spans, idx) => {
      const leaves = spans.filter((s) => s.childElementCount === 0);
      return leaves[idx]?.getAttribute("class") ?? "";
    },
    index,
  );
}

/** Send one target cell as a real keydown (⏎ → Enter, space → Space). */
async function pressCell(page: Page, cell: string): Promise<void> {
  if (cell === "⏎" || cell === "\n") {
    await page.keyboard.press("Enter");
  } else if (cell === " " || cell === "\u00a0") {
    await page.keyboard.press("Space");
  } else {
    await page.keyboard.type(cell);
  }
  await page.waitForTimeout(8);
}

/** Type the drill from cell `from` to the end. */
async function typeCells(page: Page, cells: string[], from = 0): Promise<void> {
  for (const cell of cells.slice(from)) {
    await pressCell(page, cell);
  }
}

/** Focus the typing pane and return its target cells. */
async function openDrill(page: Page, route: string): Promise<string[]> {
  await page.goto(route);
  const pane = page.locator('[data-testid="typing-pane"]');
  await expect(pane).toBeVisible();
  await pane.click();
  return targetCells(page);
}

test("reference renders all three layers with the expected legends", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/#/reference");

  const map = page.locator('svg[data-testid="keyboard-map"]');
  await expect(map).toBeVisible();
  expect(await map.locator("[data-key-id]").count()).toBeGreaterThanOrEqual(56);

  // Base layer: legends are the upper-cased chars.
  await expect(map.locator('g[data-key-id="L11"]')).toContainText("Q");
  await expect(map.locator('g[data-key-id="L35"]')).toContainText("B");

  // Lower (Fn 1): the coding symbols and the numpad legends. The tab is addressed by its
  // exact accessible name — a loose /Lower/ also matches the board's own `LT2 Lower` key.
  await page.getByRole("button", { name: "Lower (Fn 1)" }).click();
  await expect(map.locator('g[data-key-id="L35"]')).toContainText("{");
  await expect(map.locator('g[data-key-id="R11"]')).toContainText("P7");

  // Raise (Fn 2): the F-row.
  await page.getByRole("button", { name: "Raise (Fn 2)" }).click();
  await expect(map.locator('g[data-key-id="L00"]')).toContainText("F12");

  expect(errors).toEqual([]);
});

test("a stage 3 drill accepts keystrokes and completes to a summary", async ({ page }) => {
  const errors = watchErrors(page);

  const cells = await openDrill(page, "/#/drill?stage=3");
  expect(cells.length).toBeGreaterThanOrEqual(10);

  const first = cells[0] ?? "";
  const second = cells[1] ?? "";

  // A correct keystroke marks cell 0 .done and moves the cursor to cell 1.
  await pressCell(page, first);
  expect(await cellClass(page, 0)).toContain("done");
  expect(await cellClass(page, 1)).toContain("cursor");

  // A wrong keystroke marks .error and does NOT advance the cursor.
  const wrong = second === "z" ? "q" : "z";
  await page.keyboard.type(wrong);
  await page.waitForTimeout(8);
  expect(await cellClass(page, 1)).toContain("error");
  expect(await cellClass(page, 1)).not.toContain("done");

  // Backspace clears the error, then finish the line.
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(8);
  expect(await cellClass(page, 1)).not.toContain("error");
  await typeCells(page, cells, 1);

  const summary = page.locator('[data-testid="drill-summary"]');
  await expect(summary).toBeVisible();
  await expect(summary).toContainText(/wpm/i);
  await expect(summary).toContainText("%");

  expect(errors).toEqual([]);
});

test("stats renders after seeding a completed session", async ({ page }) => {
  const errors = watchErrors(page);

  // Seed through the UI: a completed drill writes a session, skill stats and a day
  // record via the MockBackend (localStorage), which works in the preview build.
  const cells = await openDrill(page, "/#/drill?stage=3");
  await typeCells(page, cells);
  await expect(page.locator('[data-testid="drill-summary"]')).toBeVisible();

  await page.goto("/#/stats");
  // If the mock's seeding hook is exposed, add 14 days of history as well.
  await page.evaluate(() => {
    const w = window as unknown as { __keydrillSeed?: (days: number) => void };
    w.__keydrillSeed?.(14);
  });
  await page.reload();

  const sessions = page.locator('[data-testid="session-count"]');
  await expect(sessions).toBeVisible();
  const sessionCount = Number((await sessions.innerText()).replace(/\D+/g, ""));
  expect(sessionCount).toBeGreaterThanOrEqual(1);

  await expect(page.locator('svg[data-testid="wpm-trend"]')).toBeVisible();
  await expect(page.locator('[data-testid="latency-split"]')).toBeVisible();
  await expect(page.locator('svg[data-testid="keyboard-map"]')).toBeVisible();

  expect(errors).toEqual([]);
});
