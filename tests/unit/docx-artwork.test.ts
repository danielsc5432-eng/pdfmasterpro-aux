import test from "node:test";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { transparentPaper } from "../../lib/processing/docx-artwork";

test("page artwork leaves paper transparent so it cannot obscure editable values", () => {
  const source = new PNG({ width: 3, height: 1 });
  source.data.set([255, 255, 255, 255, 0, 0, 0, 255, 120, 180, 210, 128]);
  const result = PNG.sync.read(Buffer.from(transparentPaper(PNG.sync.write(source))));
  assert.deepEqual([...result.data], [255, 255, 255, 0, 0, 0, 0, 255, 120, 180, 210, 128]);
});
