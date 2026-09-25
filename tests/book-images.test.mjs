import assert from "node:assert/strict";
import test from "node:test";
import { bookImageUrls, imageExtension } from "../scripts/book-images.mjs";

test("installed images follow actual Markdown and HTML image references without altering the original text", () => {
  const source = { memoryMarkup: '说明 ![配图](https://cdn.aimwords.com/word-images/test/a%20b.png) [[other|原引用]]', roots: [{ memoryMethod: '<img src="https://cdn.aimwords.com/prefix-images/test/c.jpg">' }] };
  const original = JSON.stringify(source);
  assert.deepEqual([...bookImageUrls(source)].sort(), ["https://cdn.aimwords.com/prefix-images/test/c.jpg", "https://cdn.aimwords.com/word-images/test/a%20b.png"]);
  assert.equal(JSON.stringify(source), original);
  assert.throws(() => bookImageUrls("![](https://other.test/image.png)"), /Unsupported book image/);
  assert.equal(imageExtension(Buffer.from("<html>error</html>")), false);
  assert.equal(imageExtension(Buffer.from([137,80,78,71,13,10,26,10])), "png");
});
