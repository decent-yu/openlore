import { expect, it } from "vitest";
import { validateTranslation } from "../src/modules/delivery/translation.js";

const source = `# Recovery

Use **durable state** with [the guide](https://example.com/guide?q=1#retry).

![Recovery diagram](./assets/recovery.svg "Original diagram")

> Retry with \`request_id\`.

1. Save state
2. Retry

| Option | Result |
| --- | --- |
| Retry | Safe |

~~~ts
const message = "Keep this English code";
~~~

<img src="./assets/extra.png" width="320" />

[Details][ref]

[ref]: https://example.com/reference
`;
const translated = source
  .replace("# Recovery", "# 恢复执行")
  .replace("Use **durable state** with [the guide]", "使用 **持久状态**，参见 [指南]")
  .replace("> Retry with", "> 重试时使用")
  .replace("Save state", "保存状态")
  .replace("2. Retry", "2. 重试")
  .replace("Option | Result", "方案 | 结果")
  .replace("Retry | Safe", "重试 | 安全")
  .replace("[Details]", "[详情]");

it("accepts a complete Chinese translation preserving GFM, images, code and destinations", () => {
  expect(validateTranslation(source, { markdown: translated })).toBe(translated);
});

it.each([
  translated.replace("./assets/recovery.svg", "./assets/different.svg"),
  translated.replace("Recovery diagram", "另一张图"),
  translated.replace("https://example.com/guide?q=1#retry", "https://example.com/other"),
  translated.replace("Keep this English code", "更改代码"),
  translated.replace("`request_id`", "`different_id`"),
  translated.replace('width="320"', 'width="640"'),
  translated.replace("https://example.com/reference", "https://example.com/missing"),
  translated.replace("# 恢复执行", "## 恢复执行"),
  translated.replace("2. 重试\n", ""),
  translated.replace("![Recovery diagram](./assets/recovery.svg \"Original diagram\")", ""),
])("rejects translations that change protected content or omit structure", (markdown) => {
  expect(() => validateTranslation(source, { markdown })).toThrow("译文改变");
});

it.each([null, {}, { markdown: "" }, { markdown: 123 }])("rejects invalid translation output: %j", (result) => {
  expect(() => validateTranslation(source, result)).toThrow("未返回完整译文");
});
