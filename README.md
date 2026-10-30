# 小红书网页 Ultra HDR 原图

针对笔记 `6ad20e490000000015013635` 和 `6adcdadf000000002c0252f4` 的实测和油猴脚本，测试日期 2026-10-30。

安装：在 Tampermonkey 中新建脚本，用 `xhs-ultrahdr.user.js` 的全部内容替换模板，保存后刷新小红书笔记页。已在用户 Edge 的 Tampermonkey 中进行更新及实际测试。右下角按钮可关闭并恢复网页图片，也可点「打开原图」。

默认处理详情页/详情弹窗里可见、宽至少 280 px 的 `note_pre_post_uhdr/…`、`spectrum/…`、`notes_pre_post/…` 和 `note_pre_post/…` 图片，不处理实况视频。原文件可能是 HDR 或 SDR，因此状态显示「原图：已替换」，不会将所有成功替换的图片都声称为 HDR。并发最多两张，加载失败保留网页图片。脚本不读取 Cookie，不调用第三方服务，无 GM 跨域请求权限。使用普通 `<img>` 加载 CDN 原文件。

图片右上角提供「下载原图」，右下角提供「下载本帖全部原图 ZIP」。单张与批量下载均保留原始字节，不经 Canvas、重新编码或压缩。批量优先读取当前轮播中全部图片（包含屏幕外的轮播项），排除轮播克隆；能取得页码总数时会进行核对。必要时尝试同源分享页数据。ZIP 文件按网页图片顺序编号；仅在全部请求成功后生成，失败会显示原因，不将部分图片冒充整帖完成。实况图下载其原始静态图片对象，不另行下载独立视频流。浏览器的保存方式遵循用户下载设置。

## 发现

移动端分享页 `/discovery/item/<笔记 ID>` 携带原链接的 `xsec_token` 返回了图片 `fileId`。桌面 `/explore/…` 的匿名请求在本次环境返回通用页面。移动网页下发的 `!h5_1080jpg` 文件本身也是 SDR，切换手机 User-Agent 并不能直接获得 HDR。

可用规则：

```text
https://ci.xiaohongshu.com/<完整 fileId>
```

必须保留 `note_pre_post_uhdr/` 目录。对于此帖，把 fileId 截成最后一段会返回 404。不要对带签名的网页图片 URL 仅删 `!` 后缀；直接使用独立原文件域名和完整对象路径。本次也验证了 `sns-img-qc.xhscdn.com` 和 `sns-img-bd.xhscdn.com` 返回相同字节，但脚本仅用前述域名。

第一张图片：

| 版本 | 字节数 | 增益图标记 | MPF |
| --- | ---: | --- | --- |
| H5 JPEG | 243737 | 无 | 无 |
| 原文件 | 7616401 | Adobe HDR gain map + ISO 21496-1 | 有 |

整帖 10 张：第 1、2、4–10 张共 9 张的原文件含 Adobe 增益图标记和 MPF；第 2 张未发现 ISO 增益图标记，其余 8 张存在。第 3 张是实况图，不在此脚本处理范围。详见 `research/note-images.json`；检测基于文件结构/标记，未用光度仪验证实际显示亮度。

Edge 已成功打开第一张原文件，浏览器识别为 5886 × 4244。可直接打开 `compare.html` 对比本地保存的原始字节。该页面切换同一张图片的 SDR / HDR 版本，不做转码。

## 范围与限制

- 原文件保留增益图，浏览器、系统及屏幕仍需支持相应 HDR 显示。状态「已替换」仅说明原文件加载成功，不证明实际 HDR 输出。
- 该路径规则在这篇笔记验证成功，不保证适用于小红书所有历史图片或未来 CDN 规则。若页面未在图片地址中暴露该目录，脚本不会猜测或调用 App 私有接口。
- 已在 Edge + Tampermonkey 的「打卡香港铁路博物馆」复现并修复 `spectrum/` 路径漏匹配，验证实际替换及单张下载。单张文件为 7881902 字节，检测到增益图和 MPF。站点 DOM/CSP/其他扩展仍可能影响其他帖子的行为。
- Edge 实测整帖 ZIP 下载成功，含 `01.jpg`–`18.jpg` 共 18 个文件，Python `zipfile.testzip()` 校验通过；其中 17 张检测到 Adobe HDR 增益图标记。网页轮播第 2 张的单张下载文件与 ZIP 的 `02.jpg` 字节完全一致。记录见 `research/edge-download-verification.json`。
- 原图每张数 MB，会增加流量及浏览器解码内存。整帖 ZIP 在浏览器内存中打包，大图集会使用更多内存。

运行测试：`node --test tests/userscript.test.mjs`。

格式说明：[Android Ultra HDR 格式](https://developer.android.com/media/platform/hdr-image-format)、[Adobe Gain Map](https://helpx.adobe.com/camera-raw/desktop/hdr-and-advanced-output/gain-map.html)。
