import { chromium } from "playwright"; import fs from "fs";
const dir = "/home/solvro/solvro/docs/plans/qa-run/shots";
const b = await chromium.launch(); const p = await b.newPage();
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".png"))) {
  const png = fs.readFileSync(`${dir}/${f}`).toString("base64");
  await p.setContent(`<body style="margin:0"><img id=i src="data:image/png;base64,${png}"></body>`);
  const box = await p.locator("#i").boundingBox();
  await p.setViewportSize({ width: Math.ceil(box.width), height: Math.min(Math.ceil(box.height), 16000) });
  await p.locator("#i").screenshot({ path: `${dir}/${f.replace(".png", ".jpg")}`, type: "jpeg", quality: 72 });
}
await b.close();
